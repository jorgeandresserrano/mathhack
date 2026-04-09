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

type TextRegion = {
  id: number;
  x: number;
  y: number;
  element: HTMLDivElement;
};

const GRID_SIZE = 10;
const DRAG_THRESHOLD = 4;
const EDGE_HIT_SIZE = 6;

function clampToGrid(value: number, limit: number): number {
  const snappedValue = Math.floor(value / GRID_SIZE) * GRID_SIZE;
  const maximumGridCoordinate = Math.max(
    0,
    Math.floor(Math.max(limit - 1, 0) / GRID_SIZE) * GRID_SIZE,
  );

  return Math.min(Math.max(snappedValue, 0), maximumGridCoordinate);
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

class WorksheetApp {
  private readonly worksheet: HTMLElement;
  private readonly regionsLayer: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly selectionWindow: HTMLElement;
  private readonly regions: TextRegion[] = [];
  private caretPosition: Point | null = null;
  private selectedRegionIds = new Set<number>();
  private activeRegionId: number | null = null;
  private dragSelection: DragSelectionState | null = null;
  private moveDrag: MoveDragState | null = null;
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
          return;
        }

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

    const worksheetBounds = this.worksheet.getBoundingClientRect();
    const maxGroupX = Math.max(
      0,
      worksheetBounds.width - this.moveDrag.selectionBounds.width,
    );
    const maxGroupY = Math.max(
      0,
      worksheetBounds.height - this.moveDrag.selectionBounds.height,
    );
    const nextGroupX = clampToGrid(
      this.moveDrag.selectionBounds.x + deltaX,
      maxGroupX + 1,
    );
    const nextGroupY = clampToGrid(
      this.moveDrag.selectionBounds.y + deltaY,
      maxGroupY + 1,
    );
    const offsetX = nextGroupX - this.moveDrag.selectionBounds.x;
    const offsetY = nextGroupY - this.moveDrag.selectionBounds.y;

    for (const regionId of this.moveDrag.regionIds) {
      const region = this.findRegion(regionId);
      const startPosition = this.moveDrag.startPositions.get(regionId);

      if (!region || !startPosition) {
        continue;
      }

      this.setRegionPosition(region, {
        x: startPosition.x + offsetX,
        y: startPosition.y + offsetY,
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

  private isRegionEmpty(regionId: number): boolean {
    const region = this.findRegion(regionId);

    if (!region) {
      return true;
    }

    const content = region.element.textContent?.replace(/\u00a0/g, ' ').trim();

    return !content;
  }

  private renderRegions(): void {
    for (const region of this.regions) {
      const isActive = region.id === this.activeRegionId;
      const isSelected = this.selectedRegionIds.has(region.id) && !isActive;

      region.element.classList.toggle('text-region--active', isActive);
      region.element.classList.toggle('text-region--selected', isSelected);

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

    this.caret.style.transform = `translate(${this.caretPosition.x}px, ${this.caretPosition.y}px)`;
    this.caret.classList.add('caret--visible');
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
      y: clampToGrid(point.y, bounds.height),
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
    region.element.style.top = `${position.y}px`;
  }

  private getRegionRect(region: TextRegion): Rect {
    return {
      x: region.x,
      y: region.y,
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
