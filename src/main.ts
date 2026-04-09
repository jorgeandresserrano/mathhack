import './style.css';

type WorksheetMenuApi = {
  getGridSize: () => Promise<number>;
  getTheme: () => Promise<WorksheetTheme>;
  onGridSizeChange: (listener: (gridSize: number) => void) => () => void;
  onThemeChange: (listener: (theme: WorksheetTheme) => void) => () => void;
};

type DocumentWithCaretPointApi = Document & {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

declare global {
  interface Window {
    worksheetMenu?: WorksheetMenuApi;
  }
}

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
type ResizeEdge = 'left' | 'right';
type RegionPointerAction = 'move' | 'resize-left' | 'resize-right';

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

type ResizeDragState = {
  pointerId: number;
  regionId: number;
  edge: ResizeEdge;
  origin: Point;
  startX: number;
  startWidth: number;
  startRight: number;
  captureElement: HTMLElement;
  hasMoved: boolean;
};

type RegionKind = 'math' | 'text';

type TextRegion = {
  id: number;
  x: number;
  y: number;
  kind: RegionKind;
  width: number | null;
  element: HTMLDivElement;
};

type RegionTypographyMetrics = {
  baselineOffset: number;
};

type WorksheetTheme = 'light' | 'dark';

const DEFAULT_GRID_SIZE = 20;
const DEFAULT_THEME: WorksheetTheme = 'light';
const DRAG_THRESHOLD = 4;
const EDGE_HIT_SIZE = 6;
function clampToGrid(value: number, limit: number, gridSize: number): number {
  const snappedValue = Math.floor(value / gridSize) * gridSize;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / gridSize) * gridSize,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampBaselineToGrid(
  value: number,
  limit: number,
  gridSize: number,
): number {
  const maximumGridCoordinate = Math.floor(Math.max(limit, 0) / gridSize) * gridSize;

  if (maximumGridCoordinate <= 0) {
    return 0;
  }

  const snappedValue = Math.max(gridSize, Math.ceil(value / gridSize) * gridSize);

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

function getCaretMoveDelta(event: KeyboardEvent, gridSize: number): Point | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
    return null;
  }

  switch (event.key) {
    case 'ArrowLeft':
      return { x: -gridSize, y: 0 };
    case 'ArrowRight':
      return { x: gridSize, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -gridSize };
    case 'ArrowDown':
    case 'Enter':
      return { x: 0, y: gridSize };
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

function getDirectionFromDelta(delta: Point): RegionNavigationDirection {
  if (delta.x < 0) {
    return 'left';
  }

  if (delta.x > 0) {
    return 'right';
  }

  if (delta.y < 0) {
    return 'up';
  }

  return 'down';
}

function clampToNearestGrid(
  value: number,
  limit: number,
  gridSize: number,
): number {
  const snappedValue = Math.round(value / gridSize) * gridSize;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / gridSize) * gridSize,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampToGridLeft(value: number, limit: number, gridSize: number): number {
  const snappedValue = Math.floor((value - 0.001) / gridSize) * gridSize;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / gridSize) * gridSize,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampToGridRight(value: number, limit: number, gridSize: number): number {
  const snappedValue = Math.ceil((value + 0.001) / gridSize) * gridSize;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / gridSize) * gridSize,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
}

function clampBaselineToNearestGrid(
  value: number,
  limit: number,
  gridSize: number,
): number {
  const maximumGridCoordinate = Math.floor(Math.max(limit, 0) / gridSize) * gridSize;

  if (maximumGridCoordinate <= 0) {
    return 0;
  }

  const snappedValue = Math.round(value / gridSize) * gridSize;

  return Math.min(Math.max(snappedValue, gridSize), maximumGridCoordinate);
}

function clampBaselineBelowGrid(
  value: number,
  limit: number,
  gridSize: number,
): number {
  return clampBaselineToGrid(value + 0.001, limit, gridSize);
}

function clampWidthToGrid(
  value: number,
  maxWidth: number,
  gridSize: number,
): number {
  const snappedValue = Math.round(value / gridSize) * gridSize;

  return Math.min(Math.max(snappedValue, gridSize), Math.max(gridSize, maxWidth));
}

function clampWidthUpToGrid(
  value: number,
  maxWidth: number,
  gridSize: number,
): number {
  const snappedValue = Math.ceil(value / gridSize) * gridSize;

  return Math.min(Math.max(snappedValue, gridSize), Math.max(gridSize, maxWidth));
}

class WorksheetApp {
  private readonly worksheet: HTMLElement;
  private readonly regionsLayer: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly selectionWindow: HTMLElement;
  private readonly regionTypography: RegionTypographyMetrics;
  private readonly regions: TextRegion[] = [];
  private gridSize: number;
  private theme: WorksheetTheme;
  private caretPosition: Point | null = null;
  private selectedRegionIds = new Set<number>();
  private activeRegionId: number | null = null;
  private dragSelection: DragSelectionState | null = null;
  private moveDrag: MoveDragState | null = null;
  private resizeDrag: ResizeDragState | null = null;
  private pendingRegionExit:
    | {
        regionId: number;
        caretPosition: Point;
      }
    | null = null;
  private nextRegionId = 1;

  constructor(
    root: HTMLDivElement,
    initialGridSize = DEFAULT_GRID_SIZE,
    initialTheme: WorksheetTheme = DEFAULT_THEME,
  ) {
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
    this.gridSize = initialGridSize;
    this.theme = initialTheme;
    this.regionTypography = this.measureRegionTypography();

    this.applyGridSize();
    this.applyTheme();
    this.bindEvents();
    this.renderCaret();
    this.renderSelectionWindow();
  }

  setGridSize(nextGridSize: number): void {
    if (
      !Number.isFinite(nextGridSize) ||
      nextGridSize <= 0 ||
      nextGridSize === this.gridSize
    ) {
      return;
    }

    this.cancelTransientInteractions();
    this.gridSize = nextGridSize;
    this.applyGridSize();
    this.resnapContentToGrid();
  }

  setTheme(nextTheme: WorksheetTheme): void {
    if (nextTheme === this.theme) {
      return;
    }

    this.theme = nextTheme;
    this.applyTheme();
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

  private applyGridSize(): void {
    this.worksheet.style.setProperty('--grid-size', `${this.gridSize}px`);
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme;
  }

  private cancelTransientInteractions(): void {
    if (this.resizeDrag) {
      if (this.resizeDrag.captureElement.hasPointerCapture(this.resizeDrag.pointerId)) {
        this.resizeDrag.captureElement.releasePointerCapture(this.resizeDrag.pointerId);
      }

      this.resizeDrag = null;
    }

    if (this.moveDrag) {
      if (this.moveDrag.captureElement.hasPointerCapture(this.moveDrag.pointerId)) {
        this.moveDrag.captureElement.releasePointerCapture(this.moveDrag.pointerId);
      }

      this.moveDrag = null;
    }

    if (this.dragSelection) {
      if (this.worksheet.hasPointerCapture(this.dragSelection.pointerId)) {
        this.worksheet.releasePointerCapture(this.dragSelection.pointerId);
      }

      this.dragSelection = null;
    }
  }

  private resnapContentToGrid(): void {
    const bounds = this.worksheet.getBoundingClientRect();

    if (this.caretPosition) {
      this.caretPosition = {
        x: clampToNearestGrid(this.caretPosition.x, bounds.width, this.gridSize),
        y: clampBaselineToNearestGrid(
          this.caretPosition.y,
          bounds.height,
          this.gridSize,
        ),
      };
    }

    for (const region of this.regions) {
      this.setRegionPosition(region, {
        x: clampToNearestGrid(region.x, bounds.width, this.gridSize),
        y: clampBaselineToNearestGrid(region.y, bounds.height, this.gridSize),
      });

      if (region.width !== null) {
        this.setRegionWidth(
          region,
          clampWidthToGrid(
            region.width,
            bounds.width - region.x,
            this.gridSize,
          ),
        );
      }
    }

    this.renderSelectionWindow();
    this.renderRegions();
    this.renderCaret();
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
    if (this.resizeDrag && this.resizeDrag.pointerId === event.pointerId) {
      this.updateResizeDrag(event);
      return;
    }

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
    if (this.resizeDrag && this.resizeDrag.pointerId === event.pointerId) {
      this.finishResizeDrag();
      return;
    }

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
    if (this.resizeDrag && this.resizeDrag.pointerId === event.pointerId) {
      this.finishResizeDrag();
      return;
    }

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
      : getCaretMoveDelta(event, this.gridSize);

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
      width: null,
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

      const pointerAction = this.getRegionPointerAction(region, event);

      if (pointerAction === 'resize-left' || pointerAction === 'resize-right') {
        this.startResizeDrag(
          region,
          pointerAction === 'resize-left' ? 'left' : 'right',
          event,
        );
        event.preventDefault();
        return;
      }

      if (pointerAction === 'move') {
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
      if (
        this.moveDrag?.pointerId === event.pointerId ||
        this.resizeDrag?.pointerId === event.pointerId
      ) {
        return;
      }

      const pointerAction = this.getRegionPointerAction(region, event);

      region.element.classList.toggle('text-region--move-hover', pointerAction === 'move');
      region.element.classList.toggle(
        'text-region--resize-hover',
        pointerAction === 'resize-left' || pointerAction === 'resize-right',
      );
    });

    region.element.addEventListener('pointerleave', () => {
      region.element.classList.remove(
        'text-region--move-hover',
        'text-region--resize-hover',
      );
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

  private startResizeDrag(
    region: TextRegion,
    edge: ResizeEdge,
    event: PointerEvent,
  ): void {
    if (region.kind !== 'text') {
      return;
    }

    const fixedWidth = this.ensureFixedTextRegionWidth(region);

    this.blurActiveRegion();
    this.worksheet.focus();
    this.selectedRegionIds = new Set([region.id]);
    this.activeRegionId = null;
    this.caretPosition = null;
    this.resizeDrag = {
      pointerId: event.pointerId,
      regionId: region.id,
      edge,
      origin: this.getLocalPoint(event),
      startX: region.x,
      startWidth: fixedWidth,
      startRight: region.x + fixedWidth,
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

  private updateResizeDrag(event: PointerEvent): void {
    if (!this.resizeDrag) {
      return;
    }

    const region = this.findRegion(this.resizeDrag.regionId);

    if (!region) {
      return;
    }

    const point = this.getLocalPoint(event);
    const deltaX = point.x - this.resizeDrag.origin.x;

    if (!this.resizeDrag.hasMoved && Math.abs(deltaX) <= DRAG_THRESHOLD) {
      return;
    }

    this.resizeDrag.hasMoved = true;

    const worksheetBounds = this.worksheet.getBoundingClientRect();

    if (this.resizeDrag.edge === 'right') {
      this.setRegionWidth(
        region,
        clampWidthToGrid(
          this.resizeDrag.startWidth + deltaX,
          worksheetBounds.width - this.resizeDrag.startX,
          this.gridSize,
        ),
      );

      return;
    }

    const minimumX = Math.max(0, this.resizeDrag.startRight - worksheetBounds.width);
    const maximumX = this.resizeDrag.startRight - this.gridSize;
    const nextX = Math.min(
      Math.max(
        clampToGrid(this.resizeDrag.startX + deltaX, worksheetBounds.width, this.gridSize),
        minimumX,
      ),
      maximumX,
    );

    this.setRegionPosition(region, {
      x: nextX,
      y: region.y,
    });
    this.setRegionWidth(region, this.resizeDrag.startRight - nextX);
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

  private finishResizeDrag(): void {
    if (!this.resizeDrag) {
      return;
    }

    if (this.resizeDrag.captureElement.hasPointerCapture(this.resizeDrag.pointerId)) {
      this.resizeDrag.captureElement.releasePointerCapture(this.resizeDrag.pointerId);
    }

    this.resizeDrag = null;
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

      if (
        (direction === 'left' || direction === 'right') &&
        this.canNavigateWithinRegion(region.element, direction)
      ) {
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
      if (isPlainEnter && region.width === null) {
        this.ensureFixedTextRegionWidth(region);
      }

      return;
    }

    if (this.canNavigateWithinRegion(region.element, direction)) {
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
      const isBoundaryVisible = isActive || this.selectedRegionIds.has(region.id);
      const hasFixedTextWidth = region.kind === 'text' && region.width !== null;

      region.element.classList.toggle('text-region--active', isActive);
      region.element.classList.toggle('text-region--selected', isSelected);
      region.element.classList.toggle('text-region--outlined', isBoundaryVisible);
      region.element.classList.toggle('text-region--math', region.kind === 'math');
      region.element.classList.toggle('text-region--text', region.kind === 'text');
      region.element.classList.toggle(
        'text-region--text-auto-width',
        region.kind === 'text' && region.width === null,
      );
      region.element.classList.toggle('text-region--text-fixed-width', hasFixedTextWidth);
      region.element.style.width =
        hasFixedTextWidth && region.width !== null ? `${region.width}px` : '';

      if (!this.selectedRegionIds.has(region.id) && !isActive) {
        region.element.classList.remove(
          'text-region--move-hover',
          'text-region--resize-hover',
        );
      }
    }
  }

  private renderCaret(): void {
    if (!this.caretPosition || this.activeRegionId !== null) {
      this.caret.classList.remove('caret--visible');
      return;
    }

    this.caret.style.transform = `translate(${this.caretPosition.x}px, ${this.caretPosition.y - this.gridSize}px)`;
    this.caret.classList.add('caret--visible');
  }

  private moveCaret(delta: Point): void {
    if (!this.caretPosition) {
      return;
    }

    const bounds = this.worksheet.getBoundingClientRect();

    this.caretPosition = {
      x: clampToGrid(this.caretPosition.x + delta.x, bounds.width, this.gridSize),
      y: clampBaselineToGrid(
        this.caretPosition.y + delta.y,
        bounds.height,
        this.gridSize,
      ),
    };

    const crossedRegion = this.findRegionAtCaretPosition(this.caretPosition);

    if (crossedRegion) {
      this.enterRegionFromWorksheetCaret(
        crossedRegion,
        this.caretPosition,
        getDirectionFromDelta(delta),
      );
      return;
    }

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
      DEFAULT_GRID_SIZE;

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

  private placeCaretAtStart(element: HTMLElement): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(true);
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
      x: clampToGrid(point.x, bounds.width, this.gridSize),
      y: clampBaselineToGrid(point.y, bounds.height, this.gridSize),
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

  private isRegionBoundaryVisible(region: TextRegion): boolean {
    return this.activeRegionId === region.id || this.selectedRegionIds.has(region.id);
  }

  private getRegionResizeEdge(
    region: TextRegion,
    event: PointerEvent,
  ): ResizeEdge | null {
    if (region.kind !== 'text' || !this.isRegionBoundaryVisible(region)) {
      return null;
    }

    const rect = region.element.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const leftDistance = localX;
    const rightDistance = rect.width - localX;
    const isNearLeft = leftDistance >= 0 && leftDistance <= EDGE_HIT_SIZE;
    const isNearRight = rightDistance >= 0 && rightDistance <= EDGE_HIT_SIZE;

    if (!isNearLeft && !isNearRight) {
      return null;
    }

    if (isNearLeft && isNearRight) {
      return leftDistance <= rightDistance ? 'left' : 'right';
    }

    return isNearLeft ? 'left' : 'right';
  }

  private getRegionPointerAction(
    region: TextRegion,
    event: PointerEvent,
  ): RegionPointerAction | null {
    const resizeEdge = this.getRegionResizeEdge(region, event);

    if (resizeEdge === 'left') {
      return 'resize-left';
    }

    if (resizeEdge === 'right') {
      return 'resize-right';
    }

    if (
      this.selectedRegionIds.has(region.id) &&
      this.isPointerOnRegionEdge(region, event)
    ) {
      return 'move';
    }

    return null;
  }

  private findRegionAtCaretPosition(position: Point): TextRegion | null {
    const caretRect: Rect = {
      x: position.x,
      y: position.y - this.gridSize,
      width: 1,
      height: this.gridSize,
    };

    for (let index = this.regions.length - 1; index >= 0; index -= 1) {
      const region = this.regions[index];

      if (rectsIntersect(caretRect, this.getRegionRect(region))) {
        return region;
      }
    }

    return null;
  }

  private getSelectedRegions(): TextRegion[] {
    return this.regions.filter((region) => this.selectedRegionIds.has(region.id));
  }

  private ensureFixedTextRegionWidth(region: TextRegion): number {
    if (region.width !== null) {
      return region.width;
    }

    const worksheetBounds = this.worksheet.getBoundingClientRect();
    const width = clampWidthUpToGrid(
      region.element.offsetWidth,
      worksheetBounds.width - region.x,
      this.gridSize,
    );

    this.setRegionWidth(region, width);
    this.renderRegions();

    return width;
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
    const nextGroupX = clampToGrid(
      selectionBounds.x + delta.x,
      maxGroupX + 1,
      this.gridSize,
    );
    const nextGroupY = clampToGrid(
      selectionBounds.y + delta.y,
      maxGroupY + 1,
      this.gridSize,
    );

    return {
      x: nextGroupX - selectionBounds.x,
      y: nextGroupY - selectionBounds.y,
    };
  }

  private canNavigateWithinRegion(
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

    if (region.kind === 'math') {
      return this.getBlockDirectionalExitCaretPosition(region, direction, bounds);
    }

    const currentCaretPoint = this.getRegionSelectionAnchorPoint(region);

    switch (direction) {
      case 'up':
        return {
          x: clampToNearestGrid(currentCaretPoint.x, bounds.width, this.gridSize),
          y: clampBaselineToGrid(
            currentCaretPoint.y - this.gridSize,
            bounds.height,
            this.gridSize,
          ),
        };
      case 'down':
        return this.getBlockDirectionalExitCaretPosition(region, direction, bounds);

      case 'left':
        return {
          x: clampToGridLeft(currentCaretPoint.x, bounds.width, this.gridSize),
          y: clampBaselineToNearestGrid(
            currentCaretPoint.y,
            bounds.height,
            this.gridSize,
          ),
        };
      case 'right':
        {
          const regionRect = this.getRegionRect(region);
          const exitX = clampToGridRight(
            regionRect.x + regionRect.width,
            bounds.width,
            this.gridSize,
          );

        return {
          x: exitX,
          y: clampBaselineToNearestGrid(
            region.y,
            bounds.height,
            this.gridSize,
          ),
        };
        }
    }
  }

  private getBlockDirectionalExitCaretPosition(
    region: TextRegion,
    direction: RegionNavigationDirection,
    bounds: DOMRect,
  ): Point {
    const regionRect = this.getRegionRect(region);

    switch (direction) {
      case 'up':
        return {
          x: clampToNearestGrid(region.x, bounds.width, this.gridSize),
          y: clampBaselineToGrid(
            regionRect.y - this.gridSize,
            bounds.height,
            this.gridSize,
          ),
        };
      case 'down':
        {
          const exitTop = clampToGridRight(
            regionRect.y + regionRect.height,
            bounds.height,
            this.gridSize,
          );

          return {
            x: clampToNearestGrid(region.x, bounds.width, this.gridSize),
            y: clampBaselineToGrid(
              exitTop + this.gridSize,
              bounds.height,
              this.gridSize,
            ),
          };
        }
      case 'left':
        return {
          x: clampToGridLeft(regionRect.x, bounds.width, this.gridSize),
          y: clampBaselineToNearestGrid(
            region.y,
            bounds.height,
            this.gridSize,
          ),
        };
      case 'right':
        return {
          x: clampToGridRight(
            regionRect.x + regionRect.width,
            bounds.width,
            this.gridSize,
          ),
          y: clampBaselineToNearestGrid(
            region.y,
            bounds.height,
            this.gridSize,
          ),
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

  private enterRegionFromWorksheetCaret(
    region: TextRegion,
    caretPosition: Point,
    direction: RegionNavigationDirection,
  ): void {
    this.activateRegion(region.id, { focus: true });
    this.placeCaretAtClientPoint(
      region.element,
      this.getRegionEntryClientPoint(region, caretPosition, direction),
      direction,
    );
  }

  private getRegionEntryClientPoint(
    region: TextRegion,
    caretPosition: Point,
    direction: RegionNavigationDirection,
  ): Point {
    const worksheetBounds = this.worksheet.getBoundingClientRect();
    const regionBounds = region.element.getBoundingClientRect();
    const rawClientPoint = {
      x:
        worksheetBounds.left +
        caretPosition.x +
        (direction === 'right' ? 1 : direction === 'left' ? -1 : 0),
      y:
        worksheetBounds.top +
        caretPosition.y -
        this.gridSize / 2 +
        (direction === 'down' ? 1 : direction === 'up' ? -1 : 0),
    };
    const minX = regionBounds.left + 1;
    const maxX = Math.max(regionBounds.right - 1, minX);
    const minY = regionBounds.top + 1;
    const maxY = Math.max(regionBounds.bottom - 1, minY);

    return {
      x: Math.min(Math.max(rawClientPoint.x, minX), maxX),
      y: Math.min(Math.max(rawClientPoint.y, minY), maxY),
    };
  }

  private placeCaretAtClientPoint(
    element: HTMLElement,
    clientPoint: Point,
    direction: RegionNavigationDirection,
  ): void {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const documentWithCaretPointApi = document as DocumentWithCaretPointApi;
    let range: Range | null = null;
    const caretPosition = documentWithCaretPointApi.caretPositionFromPoint?.(
      clientPoint.x,
      clientPoint.y,
    );

    if (caretPosition && element.contains(caretPosition.offsetNode)) {
      range = document.createRange();
      range.setStart(caretPosition.offsetNode, caretPosition.offset);
      range.collapse(true);
    } else {
      const caretRange = documentWithCaretPointApi.caretRangeFromPoint?.(
        clientPoint.x,
        clientPoint.y,
      );

      if (caretRange && element.contains(caretRange.startContainer)) {
        range = caretRange.cloneRange();
        range.collapse(true);
      }
    }

    if (!range) {
      if (direction === 'left') {
        this.placeCaretAtEnd(element);
      } else {
        this.placeCaretAtStart(element);
      }

      return;
    }

    selection.removeAllRanges();
    selection.addRange(range);
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

  private setRegionWidth(region: TextRegion, width: number | null): void {
    region.width = width;
    region.element.style.width = width === null ? '' : `${width}px`;
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

const rootElement = appRoot;

async function bootstrap(): Promise<void> {
  const [initialGridSize, initialTheme] = await Promise.all([
    window.worksheetMenu?.getGridSize?.(),
    window.worksheetMenu?.getTheme?.(),
  ]);
  const app = new WorksheetApp(
    rootElement,
    initialGridSize ?? DEFAULT_GRID_SIZE,
    initialTheme ?? DEFAULT_THEME,
  );

  window.worksheetMenu?.onGridSizeChange((gridSize) => {
    app.setGridSize(gridSize);
  });
  window.worksheetMenu?.onThemeChange((theme) => {
    app.setTheme(theme);
  });
}

void bootstrap();
