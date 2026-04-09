import './style.css';

type Point = {
  x: number;
  y: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SelectionMode = 'window' | 'crossing';
type RegionNavigationDirection = 'up' | 'down' | 'left' | 'right';

type DragSelectionState = {
  pointerId: number;
  origin: Point;
  current: Point;
  hasMoved: boolean;
  mode: SelectionMode;
};

type MoveDragState = {
  pointerId: number;
  origin: Point;
  regionIds: number[];
  startPositions: Map<number, Point>;
  selectionBounds: Rect;
  captureElement: HTMLElement;
  hasMoved: boolean;
};

type RegionKind = 'math' | 'text';

type TextRegion = {
  id: number;
  x: number;
  y: number;
  kind: RegionKind;
  element: HTMLDivElement;
};

type RegionTypographyMetrics = {
  baselineOffset: number;
};

const GRID_SIZE = 10;
const DRAG_THRESHOLD = 4;
const EDGE_HIT_SIZE = 6;
const CARET_VISUAL_HEIGHT = GRID_SIZE;

function clampToGrid(value: number, limit: number): number {
  const snappedValue = Math.floor(value / GRID_SIZE) * GRID_SIZE;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampBaselineToGrid(value: number, limit: number): number {
  const maximumGridCoordinate =
    Math.floor(Math.max(limit, 0) / GRID_SIZE) * GRID_SIZE;

  if (maximumGridCoordinate <= 0) {
    return 0;
  }

  const snappedValue = Math.max(
    GRID_SIZE,
    Math.ceil(value / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(snappedValue, maximumGridCoordinate);
}

function normalizeRect(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);

  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectContains(container: Rect, subject: Rect): boolean {
  return (
    subject.x >= container.x &&
    subject.y >= container.y &&
    subject.x + subject.width <= container.x + container.width &&
    subject.y + subject.height <= container.y + container.height
  );
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  );
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === 'a' &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}

function isDeleteSelectionKey(event: KeyboardEvent): boolean {
  return event.key === 'Backspace' || event.key === 'Delete';
}

function getCaretMoveDelta(event: KeyboardEvent): Point | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return null;
  }

  switch (event.key) {
    case 'ArrowLeft':
      return { x: -GRID_SIZE, y: 0 };
    case 'ArrowRight':
      return { x: GRID_SIZE, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -GRID_SIZE };
    case 'ArrowDown':
    case 'Enter':
      return { x: 0, y: GRID_SIZE };
    default:
      return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA'
  );
}

function contentContainsSpace(content: string | null | undefined): boolean {
  return /[ \u00a0]/.test(content ?? '');
}

function getFinitePositiveMetric(
  ...values: Array<number | undefined>
): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
}

function getRegionNavigationDirection(
  event: KeyboardEvent,
): RegionNavigationDirection | null {
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.isComposing
  ) {
    return null;
  }

  switch (event.key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

function clampToNearestGrid(value: number, limit: number): number {
  const snappedValue = Math.round(value / GRID_SIZE) * GRID_SIZE;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampToGridLeft(value: number, limit: number): number {
  const snappedValue = Math.floor((value - 0.001) / GRID_SIZE) * GRID_SIZE;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampToGridRight(value: number, limit: number): number {
  const snappedValue = Math.ceil((value + 0.001) / GRID_SIZE) * GRID_SIZE;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampBaselineToNearestGrid(value: number, limit: number): number {
  const maximumGridCoordinate =
    Math.floor(Math.max(limit, 0) / GRID_SIZE) * GRID_SIZE;

  if (maximumGridCoordinate <= 0) {
    return 0;
  }

  const snappedValue = Math.round(value / GRID_SIZE) * GRID_SIZE;

  return Math.min(Math.max(snappedValue, GRID_SIZE), maximumGridCoordinate);
}

function clampBaselineBelowGrid(value: number, limit: number): number {
  return clampBaselineToGrid(value + 0.001, limit);
}

class WorksheetApp {
  private readonly worksheet: HTMLElement;
  private readonly regionsLayer: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly selectionWindow: HTMLElement;
  private readonly regionTypography: RegionTypographyMetrics;
  private readonly regions: TextRegion[] = [];
  private caretPosition: Point | null = null;
  private selectedRegionIds = new Set<number>();
  private activeRegionId: number | null = null;
  private dragSelection: DragSelectionState | null = null;
  private moveDrag: MoveDragState | null = null;
  private pendingRegionExit:
    | {
        regionId: number;
        caretPosition: Point;
      }
    | null = null;
  private nextRegionId = 1;

  constructor(root: HTMLDivElement) {
    root.innerHTML = `
      <main class="worksheet" aria-label="Worksheet" tabindex="0">
        <div class="regions-layer"></div>
        <div class="caret" aria-hidden="true"></div>
        <div class="selection-window" aria-hidden="true"></div>
      </main>
    `;

    const worksheet = root.querySelector<HTMLElement>('.worksheet');
    const regionsLayer = root.querySelector<HTMLElement>('.regions-layer');
    const caret = root.querySelector<HTMLElement>('.caret');
    const selectionWindow = root.querySelector<HTMLElement>('.selection-window');

    if (!worksheet || !regionsLayer || !caret || !selectionWindow) {
      throw new Error('Worksheet UI failed to initialize.');
    }

    this.worksheet = worksheet;
    this.regionsLayer = regionsLayer;
    this.caret = caret;
    this.selectionWindow = selectionWindow;
    this.regionTypography = this.measureRegionTypography();

    this.bindEvents();
    this.renderCaret();
    this.renderSelectionWindow();
  }

  private bindEvents(): void {
    this.worksheet.addEventListener('pointerdown', this.handleWorksheetPointerDown);
    this.worksheet.addEventListener('pointermove', this.handleWorksheetPointerMove);
    this.worksheet.addEventListener('pointerup', this.handleWorksheetPointerUp);
    this.worksheet.addEventListener(
      'pointercancel',
      this.handleWorksheetPointerCancel,
    );
    window.addEventListener('keydown', this.handleWindowKeyDown);
  }

  private readonly handleWorksheetPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.getRegionElement(event.target)) {
      return;
    }

    const point = this.getLocalPoint(event);

    this.blurActiveRegion();
    this.clearNativeSelection();
    this.worksheet.focus();
    this.dragSelection = {
      pointerId: event.pointerId,
      origin: point,
      current: point,
      hasMoved: false,
      mode: 'window',
    };
    this.worksheet.setPointerCapture(event.pointerId);
    this.renderSelectionWindow();
    event.preventDefault();
  };

  private readonly handleWorksheetPointerMove = (event: PointerEvent): void => {
    if (this.moveDrag && this.moveDrag.pointerId === event.pointerId) {
      this.updateMoveDrag(event);
      return;
    }

    if (!this.dragSelection || this.dragSelection.pointerId !== event.pointerId) {
      return;
    }

    const nextPoint = this.getLocalPoint(event);
    const deltaX = nextPoint.x - this.dragSelection.origin.x;
    const deltaY = nextPoint.y - this.dragSelection.origin.y;
    const hasMoved =
      Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(deltaY) > DRAG_THRESHOLD;

    this.dragSelection.current = nextPoint;
    this.dragSelection.mode = deltaX >= 0 ? 'window' : 'crossing';
    this.dragSelection.hasMoved = hasMoved;

    if (hasMoved) {
      this.applyDragSelection();
    }

    this.renderSelectionWindow();
  };

  private readonly handleWorksheetPointerUp = (event: PointerEvent): void => {
    if (this.moveDrag && this.moveDrag.pointerId === event.pointerId) {
      this.finishMoveDrag();
      return;
    }

    if (!this.dragSelection || this.dragSelection.pointerId !== event.pointerId) {
      return;
    }

    const point = this.getLocalPoint(event);

    if (this.dragSelection.hasMoved) {
      this.dragSelection.current = point;
      this.applyDragSelection();
    } else {
      this.selectedRegionIds.clear();
      this.activeRegionId = null;
      this.caretPosition = this.snapPointToGrid(point);
    }

    this.finishDragSelection();
  };

  private readonly handleWorksheetPointerCancel = (event: PointerEvent): void => {
    if (this.moveDrag && this.moveDrag.pointerId === event.pointerId) {
      this.finishMoveDrag();
      return;
    }

    if (!this.dragSelection || this.dragSelection.pointerId !== event.pointerId) {
      return;
    }

    this.finishDragSelection();
  };

  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (isSelectAllShortcut(event) && !isEditableTarget(event.target)) {
      event.preventDefault();
      this.selectAllRegions();
      return;
    }

    if (
      isDeleteSelectionKey(event) &&
      !isEditableTarget(event.target) &&
      this.selectedRegionIds.size > 0
    ) {
      event.preventDefault();
      this.deleteSelectedRegions();
      return;
    }

    const caretMoveDelta = isEditableTarget(event.target)
      ? null
      : getCaretMoveDelta(event);

    if (caretMoveDelta && this.selectedRegionIds.size > 0) {
      event.preventDefault();
      this.moveSelectedRegions(caretMoveDelta);
      return;
    }

    if (caretMoveDelta && this.caretPosition) {
      event.preventDefault();
      this.moveCaret(caretMoveDelta);
      return;
    }

    if (!isPrintableKey(event) || isEditableTarget(event.target)) {
      return;
    }

    if (!this.caretPosition) {
      return;
    }

    event.preventDefault();

    const region = this.createRegion(this.caretPosition, event.key);

    this.activateRegion(region.id, { focus: true, placeCaretAtEnd: true });
  };

  private createRegion(position: Point, initialText: string): TextRegion {
    const element = document.createElement('div');
    const region: TextRegion = {
      id: this.nextRegionId,
      x: position.x,
      y: position.y,
      kind: contentContainsSpace(initialText) ? 'text' : 'math',
      element,
    };

    this.nextRegionId += 1;
    element.className = 'text-region';
    element.contentEditable = 'true';
    element.spellcheck = false;
    element.dataset.regionId = String(region.id);
    element.textContent = initialText;
    this.setRegionPosition(region, position);
    this.attachRegionEvents(region);
    this.regions.push(region);
    this.regionsLayer.append(element);
    this.renderRegions();

    return region;
  }

  private attachRegionEvents(region: TextRegion): void {
    region.element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (
        this.selectedRegionIds.has(region.id) &&
        this.isPointerOnRegionEdge(region, event)
      ) {
        this.startMoveDrag(region, event);
        event.preventDefault();
        return;
      }

      this.activateRegion(region.id);
    });

    region.element.addEventListener('focus', () => {
      this.activateRegion(region.id);
    });

    region.element.addEventListener('keydown', (event) => {
      this.handleRegionKeyDown(region, event);
    });

    region.element.addEventListener('input', () => {
      this.updateRegionKind(region.id);
    });

    region.element.addEventListener('pointermove', (event) => {
      const shouldShowMoveCursor =
        this.selectedRegionIds.has(region.id) &&
        this.isPointerOnRegionEdge(region, event) &&
        this.moveDrag?.pointerId !== event.pointerId;

      region.element.classList.toggle('text-region--edge-hover', shouldShowMoveCursor);
    });

    region.element.addEventListener('pointerleave', () => {
      region.element.classList.remove('text-region--edge-hover');
    });

    region.element.addEventListener('blur', () => {
      queueMicrotask(() => {
        if (!this.findRegion(region.id)) {
          return;
        }

        if (this.activeRegionId === region.id) {
          this.activeRegionId = null;
        }

        if (this.isRegionEmpty(region.id)) {
          this.removeRegion(region.id);
          this.applyPendingRegionExit(region.id);
          return;
        }

        this.updateRegionKind(region.id);
        this.applyPendingRegionExit(region.id);
        this.renderRegions();
        this.renderCaret();
      });
    });
  }

  private activateRegion(
    regionId: number,
    options: { focus?: boolean; placeCaretAtEnd?: boolean } = {},
  ): void {
    const region = this.findRegion(regionId);

    if (!region) {
      return;
    }

    this.selectedRegionIds = new Set([regionId]);
    this.activeRegionId = regionId;
    this.caretPosition = null;
    this.renderRegions();
    this.renderCaret();

    if (options.focus && document.activeElement !== region.element) {
      region.element.focus();
    }

    if (options.placeCaretAtEnd) {
      this.placeCaretAtEnd(region.element);
    }
  }

  private selectAllRegions(): void {
    this.blurActiveRegion();
    this.clearNativeSelection();
    this.selectedRegionIds = new Set(this.regions.map((region) => region.id));
    this.activeRegionId = null;
    this.caretPosition = null;
    this.renderRegions();
    this.renderCaret();
  }

  private applyDragSelection(): void {
    if (!this.dragSelection) {
      return;
    }

    const selectionRect = normalizeRect(
      this.dragSelection.origin,
      this.dragSelection.current,
    );
    const nextSelection = new Set<number>();

    for (const region of this.regions) {
      const regionRect = this.getRegionRect(region);
      const isSelected =
        this.dragSelection.mode === 'window'
          ? rectContains(selectionRect, regionRect)
          : rectsIntersect(selectionRect, regionRect);

      if (isSelected) {
        nextSelection.add(region.id);
      }
    }

    this.selectedRegionIds = nextSelection;
    this.activeRegionId = null;
    this.caretPosition = null;
    this.renderRegions();
    this.renderCaret();
  }

  private startMoveDrag(region: TextRegion, event: PointerEvent): void {
    const selectedRegions = this.getSelectedRegions();
    const regionsToMove = selectedRegions.some(
      (selectedRegion) => selectedRegion.id === region.id,
    )
      ? selectedRegions
      : [region];
    const regionIds = regionsToMove.map((selectedRegion) => selectedRegion.id);
    const startPositions = new Map<number, Point>();

    for (const selectedRegion of regionsToMove) {
      startPositions.set(selectedRegion.id, {
        x: selectedRegion.x,
        y: selectedRegion.y,
      });
    }

    this.blurActiveRegion();
    this.worksheet.focus();
    this.selectedRegionIds = new Set(regionIds);
    this.activeRegionId = null;
    this.caretPosition = null;
    this.moveDrag = {
      pointerId: event.pointerId,
      origin: this.getLocalPoint(event),
      regionIds,
      startPositions,
      selectionBounds: this.getCombinedRegionBounds(regionsToMove),
      captureElement: region.element,
      hasMoved: false,
    };
    region.element.setPointerCapture(event.pointerId);
    this.renderRegions();
    this.renderCaret();
  }

  private updateMoveDrag(event: PointerEvent): void {
    if (!this.moveDrag) {
      return;
    }

    const point = this.getLocalPoint(event);
    const deltaX = point.x - this.moveDrag.origin.x;
    const deltaY = point.y - this.moveDrag.origin.y;

    if (
      !this.moveDrag.hasMoved &&
      Math.abs(deltaX) <= DRAG_THRESHOLD &&
      Math.abs(deltaY) <= DRAG_THRESHOLD
    ) {
      return;
    }

    this.moveDrag.hasMoved = true;

    const offset = this.getClampedRegionGroupOffset(this.moveDrag.selectionBounds, {
      x: deltaX,
      y: deltaY,
    });

    for (const regionId of this.moveDrag.regionIds) {
      const region = this.findRegion(regionId);
      const startPosition = this.moveDrag.startPositions.get(regionId);

      if (!region || !startPosition) {
        continue;
      }

      this.setRegionPosition(region, {
        x: startPosition.x + offset.x,
        y: startPosition.y + offset.y,
      });
    }
  }

  private finishMoveDrag(): void {
    if (!this.moveDrag) {
      return;
    }

    if (this.moveDrag.captureElement.hasPointerCapture(this.moveDrag.pointerId)) {
      this.moveDrag.captureElement.releasePointerCapture(this.moveDrag.pointerId);
    }

    this.moveDrag = null;
    this.renderRegions();
    this.renderCaret();
  }

  private finishDragSelection(): void {
    if (this.dragSelection) {
      if (this.worksheet.hasPointerCapture(this.dragSelection.pointerId)) {
        this.worksheet.releasePointerCapture(this.dragSelection.pointerId);
      }

      this.dragSelection = null;
    }

    this.renderSelectionWindow();
    this.renderRegions();
    this.renderCaret();
  }

  private removeRegion(regionId: number): void {
    const regionIndex = this.regions.findIndex((region) => region.id === regionId);

    if (regionIndex === -1) {
      return;
    }

    const [region] = this.regions.splice(regionIndex, 1);

    region.element.remove();
    this.selectedRegionIds.delete(regionId);

    if (this.activeRegionId === regionId) {
      this.activeRegionId = null;
    }

    this.renderRegions();
    this.renderCaret();
  }

  private deleteSelectedRegions(): void {
    const regionIds = [...this.selectedRegionIds];

    if (regionIds.length === 0) {
      return;
    }

    this.blurActiveRegion();
    this.clearNativeSelection();

    for (const regionId of regionIds) {
      const regionIndex = this.regions.findIndex((region) => region.id === regionId);

      if (regionIndex === -1) {
        continue;
      }

      const [region] = this.regions.splice(regionIndex, 1);

      region.element.remove();
    }

    this.selectedRegionIds.clear();
    this.activeRegionId = null;
    this.caretPosition = null;
    this.renderRegions();
    this.renderCaret();
  }

  private handleRegionKeyDown(region: TextRegion, event: KeyboardEvent): void {
    const direction = getRegionNavigationDirection(event);
    const isPlainEnter =
      event.key === 'Enter' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.isComposing;

    if (region.kind === 'math') {
      if (!direction && !isPlainEnter) {
        return;
      }

      event.preventDefault();
      this.exitRegionEditing(
        region.id,
        this.getDirectionalExitCaretPosition(region, direction ?? 'down'),
      );
      return;
    }

    if (!direction) {
      return;
    }

    if (this.canNavigateWithinTextRegion(region.element, direction)) {
      return;
    }

    event.preventDefault();
    this.exitRegionEditing(
      region.id,
      this.getDirectionalExitCaretPosition(region, direction),
    );
  }

  private exitRegionEditing(regionId: number, caretPosition?: Point): void {
    const region = this.findRegion(regionId);

    if (!region) {
      return;
    }

    this.pendingRegionExit = {
      regionId,
      caretPosition:
        caretPosition ?? this.getDirectionalExitCaretPosition(region, 'down'),
    };
    this.clearNativeSelection();
    region.element.blur();
  }

  private isRegionEmpty(regionId: number): boolean {
    const region = this.findRegion(regionId);

    if (!region) {
      return true;
    }

    const content = region.element.textContent?.replace(/\u00a0/g, ' ').trim();

    return !content;
  }

  private updateRegionKind(regionId: number): void {
    const region = this.findRegion(regionId);

    if (!region) {
      return;
    }

    if (region.kind === 'math' && contentContainsSpace(region.element.textContent)) {
      region.kind = 'text';
      this.renderRegions();
    }
  }

  private applyPendingRegionExit(regionId: number): void {
    if (this.pendingRegionExit?.regionId !== regionId) {
      return;
    }

    this.selectedRegionIds.clear();
    this.activeRegionId = null;
    this.caretPosition = this.pendingRegionExit.caretPosition;
    this.pendingRegionExit = null;
    this.clearNativeSelection();
  }

  private renderRegions(): void {
    for (const region of this.regions) {
      const isActive = region.id === this.activeRegionId;
      const isSelected = this.selectedRegionIds.has(region.id) && !isActive;

      region.element.classList.toggle('text-region--active', isActive);
      region.element.classList.toggle('text-region--selected', isSelected);
      region.element.classList.toggle('text-region--math', region.kind === 'math');
      region.element.classList.toggle('text-region--text', region.kind === 'text');

      if (!this.selectedRegionIds.has(region.id)) {
        region.element.classList.remove('text-region--edge-hover');
      }
    }
  }

  private renderCaret(): void {
    if (!this.caretPosition || this.activeRegionId !== null) {
      this.caret.classList.remove('caret--visible');
      return;
    }

    this.caret.style.transform = `translate(${this.caretPosition.x}px, ${this.caretPosition.y - CARET_VISUAL_HEIGHT}px)`;
    this.caret.classList.add('caret--visible');
  }

  private moveCaret(delta: Point): void {
    if (!this.caretPosition) {
      return;
    }

    const bounds = this.worksheet.getBoundingClientRect();

    this.caretPosition = {
      x: clampToGrid(this.caretPosition.x + delta.x, bounds.width),
      y: clampBaselineToGrid(this.caretPosition.y + delta.y, bounds.height),
    };
    this.renderCaret();
  }

  private moveSelectedRegions(delta: Point): void {
    const selectedRegions = this.getSelectedRegions();

    if (selectedRegions.length === 0) {
      return;
    }

    const selectionBounds = this.getCombinedRegionBounds(selectedRegions);
    const offset = this.getClampedRegionGroupOffset(selectionBounds, delta);

    if (offset.x === 0 && offset.y === 0) {
      return;
    }

    this.blurActiveRegion();
    this.clearNativeSelection();
    this.caretPosition = null;

    for (const region of selectedRegions) {
      this.setRegionPosition(region, {
        x: region.x + offset.x,
        y: region.y + offset.y,
      });
    }

    this.renderRegions();
    this.renderCaret();
  }

  private renderSelectionWindow(): void {
    if (!this.dragSelection || !this.dragSelection.hasMoved) {
      this.selectionWindow.classList.remove(
        'selection-window--visible',
        'selection-window--window',
        'selection-window--crossing',
      );
      return;
    }

    const rect = normalizeRect(
      this.dragSelection.origin,
      this.dragSelection.current,
    );

    this.selectionWindow.style.left = `${rect.x}px`;
    this.selectionWindow.style.top = `${rect.y}px`;
    this.selectionWindow.style.width = `${rect.width}px`;
    this.selectionWindow.style.height = `${rect.height}px`;
    this.selectionWindow.classList.add('selection-window--visible');
    this.selectionWindow.classList.toggle(
      'selection-window--window',
      this.dragSelection.mode === 'window',
    );
    this.selectionWindow.classList.toggle(
      'selection-window--crossing',
      this.dragSelection.mode === 'crossing',
    );
  }

  private measureRegionTypography(): RegionTypographyMetrics {
    const probe = document.createElement('div');

    probe.className = 'text-region';
    probe.textContent = 'Hg';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    this.regionsLayer.append(probe);

    const styles = window.getComputedStyle(probe);
    const computedLineHeight = Number.parseFloat(styles.lineHeight);
    const measuredHeight = probe.getBoundingClientRect().height;
    const fontSize = Number.parseFloat(styles.fontSize);
    const lineHeight =
      getFinitePositiveMetric(computedLineHeight, measuredHeight, fontSize) ??
      GRID_SIZE;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let baselineOffset = lineHeight;

    if (context) {
      context.font = [
        styles.fontStyle,
        styles.fontVariant,
        styles.fontWeight,
        styles.fontSize,
        styles.fontFamily,
      ].join(' ');

      const metrics = context.measureText('Hg') as TextMetrics & {
        emHeightAscent?: number;
        emHeightDescent?: number;
        fontBoundingBoxAscent?: number;
        fontBoundingBoxDescent?: number;
      };
      const ascent = getFinitePositiveMetric(
        metrics.emHeightAscent,
        metrics.fontBoundingBoxAscent,
        metrics.actualBoundingBoxAscent,
      );
      const descent =
        getFinitePositiveMetric(
          metrics.emHeightDescent,
          metrics.fontBoundingBoxDescent,
          metrics.actualBoundingBoxDescent,
        ) ?? 0;

      if (ascent !== null) {
        const glyphHeight = ascent + descent;
        const extraLeading = Math.max(lineHeight - glyphHeight, 0);

        baselineOffset = extraLeading / 2 + ascent;
      }
    }

    probe.remove();

    return {
      baselineOffset,
    };
  }

  private placeCaretAtEnd(element: HTMLElement): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private clearNativeSelection(): void {
    window.getSelection()?.removeAllRanges();
  }

  private blurActiveRegion(): void {
    if (!(document.activeElement instanceof HTMLElement)) {
      return;
    }

    if (document.activeElement.closest('.text-region')) {
      document.activeElement.blur();
    }
  }

  private getLocalPoint(event: PointerEvent): Point {
    const bounds = this.worksheet.getBoundingClientRect();

    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    };
  }

  private snapPointToGrid(point: Point): Point {
    const bounds = this.worksheet.getBoundingClientRect();

    return {
      x: clampToGrid(point.x, bounds.width),
      y: clampBaselineToGrid(point.y, bounds.height),
    };
  }

  private getRegionElement(target: EventTarget | null): HTMLDivElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest<HTMLDivElement>('.text-region');
  }

  private findRegion(regionId: number): TextRegion | undefined {
    return this.regions.find((region) => region.id === regionId);
  }

  private getSelectedRegions(): TextRegion[] {
    return this.regions.filter((region) => this.selectedRegionIds.has(region.id));
  }

  private getCombinedRegionBounds(regions: TextRegion[]): Rect {
    const regionRects = regions.map((region) => this.getRegionRect(region));
    const left = Math.min(...regionRects.map((rect) => rect.x));
    const top = Math.min(...regionRects.map((rect) => rect.y));
    const right = Math.max(...regionRects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...regionRects.map((rect) => rect.y + rect.height));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  private getClampedRegionGroupOffset(
    selectionBounds: Rect,
    delta: Point,
  ): Point {
    const worksheetBounds = this.worksheet.getBoundingClientRect();
    const maxGroupX = Math.max(0, worksheetBounds.width - selectionBounds.width);
    const maxGroupY = Math.max(0, worksheetBounds.height - selectionBounds.height);
    const nextGroupX = clampToGrid(selectionBounds.x + delta.x, maxGroupX + 1);
    const nextGroupY = clampToGrid(selectionBounds.y + delta.y, maxGroupY + 1);

    return {
      x: nextGroupX - selectionBounds.x,
      y: nextGroupY - selectionBounds.y,
    };
  }

  private canNavigateWithinTextRegion(
    element: HTMLElement,
    direction: RegionNavigationDirection,
  ): boolean {
    const selection = window.getSelection();

    if (
      !selection ||
      !selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !this.isSelectionWithinElement(selection, element)
    ) {
      return true;
    }

    const selectionWithModify = selection as Selection & {
      modify?: (
        alter: 'move' | 'extend',
        direction: 'forward' | 'backward' | 'left' | 'right',
        granularity:
          | 'character'
          | 'word'
          | 'sentence'
          | 'line'
          | 'paragraph'
          | 'lineboundary'
          | 'sentenceboundary'
          | 'paragraphboundary'
          | 'documentboundary'
      ) => void;
    };

    if (typeof selectionWithModify.modify !== 'function') {
      return true;
    }

    const originalRange = selection.getRangeAt(0).cloneRange();
    const originalSnapshot = this.captureSelectionSnapshot(selection);
    const movement =
      direction === 'left'
        ? { direction: 'backward' as const, granularity: 'character' as const }
        : direction === 'right'
          ? { direction: 'forward' as const, granularity: 'character' as const }
          : direction === 'up'
            ? { direction: 'backward' as const, granularity: 'line' as const }
            : { direction: 'forward' as const, granularity: 'line' as const };

    selectionWithModify.modify('move', movement.direction, movement.granularity);

    const moved =
      this.isSelectionWithinElement(selection, element) &&
      this.didSelectionSnapshotChange(
        originalSnapshot,
        this.captureSelectionSnapshot(selection),
      );

    selection.removeAllRanges();
    selection.addRange(originalRange);

    return moved;
  }

  private captureSelectionSnapshot(selection: Selection): {
    node: Node | null;
    offset: number;
    rect: DOMRect | null;
  } {
    return {
      node: selection.focusNode,
      offset: selection.focusOffset,
      rect: this.getSelectionCaretRect(selection),
    };
  }

  private didSelectionSnapshotChange(
    before: {
      node: Node | null;
      offset: number;
      rect: DOMRect | null;
    },
    after: {
      node: Node | null;
      offset: number;
      rect: DOMRect | null;
    },
  ): boolean {
    if (before.node !== after.node || before.offset !== after.offset) {
      return true;
    }

    if (!before.rect || !after.rect) {
      return false;
    }

    return (
      Math.abs(before.rect.left - after.rect.left) > 0.5 ||
      Math.abs(before.rect.top - after.rect.top) > 0.5
    );
  }

  private getSelectionCaretRect(selection: Selection): DOMRect | null {
    if (selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();

    range.collapse(selection.isCollapsed);

    const clientRect = range.getClientRects().item(0);
    const fallbackRect = range.getBoundingClientRect();
    const rect = clientRect ?? fallbackRect;

    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      (!rect.width && !rect.height)
    ) {
      return null;
    }

    return rect;
  }

  private isSelectionWithinElement(
    selection: Selection,
    element: HTMLElement,
  ): boolean {
    return (
      !!selection.anchorNode &&
      !!selection.focusNode &&
      element.contains(selection.anchorNode) &&
      element.contains(selection.focusNode)
    );
  }

  private getDirectionalExitCaretPosition(
    region: TextRegion,
    direction: RegionNavigationDirection,
  ): Point {
    const bounds = this.worksheet.getBoundingClientRect();
    const currentCaretPoint = this.getRegionSelectionAnchorPoint(region);

    switch (direction) {
      case 'up':
        return {
          x: clampToNearestGrid(currentCaretPoint.x, bounds.width),
          y: clampBaselineToGrid(currentCaretPoint.y - GRID_SIZE, bounds.height),
        };
      case 'down':
        return {
          x: clampToNearestGrid(currentCaretPoint.x, bounds.width),
          y: clampBaselineBelowGrid(currentCaretPoint.y, bounds.height),
        };
      case 'left':
        return {
          x: clampToGridLeft(currentCaretPoint.x, bounds.width),
          y: clampBaselineToNearestGrid(currentCaretPoint.y, bounds.height),
        };
      case 'right':
        return {
          x: clampToGridRight(currentCaretPoint.x, bounds.width),
          y: clampBaselineToNearestGrid(currentCaretPoint.y, bounds.height),
        };
    }
  }

  private getRegionSelectionAnchorPoint(region: TextRegion): Point {
    const selection = window.getSelection();

    if (selection && this.isSelectionWithinElement(selection, region.element)) {
      const rect = this.getSelectionCaretRect(selection);

      if (rect) {
        const worksheetBounds = this.worksheet.getBoundingClientRect();

        return {
          x: Math.min(
            Math.max(rect.left - worksheetBounds.left, 0),
            worksheetBounds.width,
          ),
          y: Math.min(
            Math.max(
              rect.top - worksheetBounds.top + this.regionTypography.baselineOffset,
              0,
            ),
            worksheetBounds.height,
          ),
        };
      }
    }

    return {
      x: region.x,
      y: region.y,
    };
  }

  private isPointerOnRegionEdge(
    region: TextRegion,
    event: PointerEvent,
  ): boolean {
    const rect = region.element.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const rightDistance = rect.width - localX;
    const bottomDistance = rect.height - localY;

    return (
      localX <= EDGE_HIT_SIZE ||
      localY <= EDGE_HIT_SIZE ||
      rightDistance <= EDGE_HIT_SIZE ||
      bottomDistance <= EDGE_HIT_SIZE
    );
  }

  private setRegionPosition(region: TextRegion, position: Point): void {
    region.x = position.x;
    region.y = position.y;
    region.element.style.left = `${position.x}px`;
    region.element.style.top = `${position.y - this.regionTypography.baselineOffset}px`;
  }

  private getRegionRect(region: TextRegion): Rect {
    return {
      x: region.element.offsetLeft,
      y: region.element.offsetTop,
      width: region.element.offsetWidth,
      height: region.element.offsetHeight,
    };
  }
}

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root was not found.');
}

new WorksheetApp(appRoot);
