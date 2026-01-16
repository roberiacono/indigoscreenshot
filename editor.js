/**
 * SnapEdit - Pro Editor Logic
 * Implements a simple Scene Graph / Layer system for object-oriented canvas editing.
 */

// --- Base Classes ---

class Layer {
    constructor(type) {
        this.type = type;
        this.id = Math.random().toString(36).substr(2, 9);
        this.visible = true;
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.selected = false;
        this.selectable = true;
    }

    draw(ctx) {}
    
    contains(x, y) {
        return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
    }

    move(dx, dy) {
        this.x += dx;
        this.y += dy;
    }

    clone() {
        const clone = new Layer(this.type);
        Object.assign(clone, this);
        return clone;
    }
}

class ImageLayer extends Layer {
    constructor(img, x = 0, y = 0) {
        super('image');
        this.img = img;
        this.x = x;
        this.y = y;
        this.width = img.width;
        this.height = img.height;
        this.selectable = false; // Background usually not selectable
    }

    draw(ctx) {
        if (!this.visible) return;
        ctx.drawImage(this.img, this.x, this.y, this.width, this.height);
    }
    
    clone() {
        const clone = new ImageLayer(this.img, this.x, this.y);
        Object.assign(clone, this);
        return clone;
    }
}

class ShapeLayer extends Layer {
    constructor(type, x, y, w, h, options) {
        super(type); // 'rect', 'circle'
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
        this.stroke = options.stroke || '#7c86ff';
        this.strokeWidth = options.strokeWidth || 4;
        this.fill = options.fill || null;
    }

    draw(ctx) {
        if (!this.visible) return;
        ctx.beginPath();
        if (this.type === 'rect') {
            ctx.rect(this.x, this.y, this.width, this.height);
        } else if (this.type === 'circle') {
            const centerX = this.x + this.width / 2;
            const centerY = this.y + this.height / 2;
            const radiusX = Math.abs(this.width / 2);
            const radiusY = Math.abs(this.height / 2);
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        }

        if (this.fill) {
            ctx.fillStyle = this.fill;
            ctx.fill();
        }
        ctx.strokeStyle = this.stroke;
        ctx.lineWidth = this.strokeWidth;
        ctx.stroke();

        if (this.selected) this.drawSelection(ctx);
    }
    
    drawSelection(ctx) {
        ctx.save();
        ctx.strokeStyle = '#00a8ff';
        const zoom = window.editor ? window.editor.viewport.scale : 1;
        ctx.lineWidth = 1 / zoom; 
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4);
        
        // Draw Handles
        const handleSize = 8 / zoom;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#00a8ff';
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([]); // solid line

        const handles = this.getHandles();
        for (const [key, h] of Object.entries(handles)) {
            ctx.beginPath();
            ctx.rect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    getHandles() {
        const x = this.x;
        const y = this.y;
        const w = this.width;
        const h = this.height;
        return {
            nw: { x: x, y: y, cursor: 'nwse-resize' },
            n:  { x: x + w/2, y: y, cursor: 'ns-resize' },
            ne: { x: x + w, y: y, cursor: 'nesw-resize' },
            e:  { x: x + w, y: y + h/2, cursor: 'ew-resize' },
            se: { x: x + w, y: y + h, cursor: 'nwse-resize' },
            s:  { x: x + w/2, y: y + h, cursor: 'ns-resize' },
            sw: { x: x, y: y + h, cursor: 'nesw-resize' },
            w:  { x: x, y: y + h/2, cursor: 'ew-resize' }
        };
    }

    getHandleAt(mouseX, mouseY, zoom) {
        if (!this.selected) return null;
        const handles = this.getHandles();
        const tolerance = 6 / zoom; // Hit area
        
        for (const [key, h] of Object.entries(handles)) {
            if (mouseX >= h.x - tolerance && mouseX <= h.x + tolerance &&
                mouseY >= h.y - tolerance && mouseY <= h.y + tolerance) {
                return key;
            }
        }
        return null;
    }

    clone() {
        const clone = new ShapeLayer(this.type, this.x, this.y, this.width, this.height, {
            stroke: this.stroke,
            strokeWidth: this.strokeWidth,
            fill: this.fill
        });
        Object.assign(clone, this);
        return clone;
    }
}

// --- Main Editor Class ---

class Editor {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.wrapper = document.getElementById('canvas-wrapper');
        
        this.layers = [];
        this.activeTool = 'select';
        this.currentLayer = null;
        this.selectedLayer = null;
        this.resizingHandle = null; // 'active' handle during resize
        
        // History
        this.history = [];
        this.redoStack = [];
        
        // Transform State
        this.viewport = {
            scale: 1,
            offsetX: 0,
            offsetY: 0
        };

        // Properties
        this.props = {
            color: '#7c86ff',
            strokeWidth: 4,
            fill: null
        };
        
        this.state = {
            isDragging: false,
            startX: 0,
            startY: 0,
            isSpacePressed: false,
            initialDragX: 0,
            initialDragY: 0,
            initialShapeState: null // For resizing
        };

        // Crop State
        this.cropSelection = null; 

        window.editor = this; // Global access for zoom in classes
        this.init();
    }

    init() {
        chrome.storage.local.get(['capturedScreenshot'], (result) => {
            if (result.capturedScreenshot) {
                const img = new Image();
                img.onload = () => {
                    this.setupCanvas(img);
                    this.saveState(); // Initial state
                };
                img.src = result.capturedScreenshot;
            }
        });

        this.bindEvents();
    }

    setupCanvas(img) {
        this.canvas.width = img.width;
        this.canvas.height = img.height;
        this.layers.push(new ImageLayer(img));
        
        this.fitToScreen();
    }

    saveState() {
        const state = {
            layers: this.layers.map(l => l.clone()),
            width: this.canvas.width,
            height: this.canvas.height
        };
        this.history.push(state);
        this.redoStack = []; 
        
        if (this.history.length > 50) this.history.shift();
    }

    undo() {
        if (this.history.length <= 1) return;
        
        const current = this.history.pop();
        this.redoStack.push(current);
        
        const previous = this.history[this.history.length - 1];
        
        this.canvas.width = previous.width;
        this.canvas.height = previous.height;
        
        this.layers = previous.layers.map(l => l.clone());
        this.selectedLayer = null; 
        this.render();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        
        const next = this.redoStack.pop();
        this.history.push(next);
        
        this.canvas.width = next.width;
        this.canvas.height = next.height;
        
        this.layers = next.layers.map(l => l.clone());
        this.selectedLayer = null;
        this.render();
    }

    fitToScreen() {
        const padding = 40;
        const container = this.wrapper.parentElement; 
        
        const availableW = container.clientWidth - padding * 2;
        const availableH = container.clientHeight - padding * 2;
        
        const scaleW = availableW / this.canvas.width;
        const scaleH = availableH / this.canvas.height;
        
        const scale = Math.min(scaleW, scaleH, 1); 
        
        this.viewport.scale = scale;
        // Offsets handled by CSS Grid centering + Scrollbars
        this.viewport.offsetX = 0;
        this.viewport.offsetY = 0;
        
        this.updateTransform();
        this.render();
    }

    updateTransform() {
        // Enforce origin
        this.canvas.style.transformOrigin = '0 0'; 
        
        // Scale the canvas visually
        this.canvas.style.transform = `scale(${this.viewport.scale})`;
        
        // Resize wrapper to force scrollbars on parent
        const scaledWidth = this.canvas.width * this.viewport.scale;
        const scaledHeight = this.canvas.height * this.viewport.scale;
        
        this.wrapper.style.width = `${scaledWidth}px`;
        this.wrapper.style.height = `${scaledHeight}px`;

        document.getElementById('zoomLevel').textContent = `${Math.round(this.viewport.scale * 100)}%`;
    }

    bindEvents() {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tool = btn.dataset.tool;
                if (btn.id === 'btnZoomIn') this.zoom(0.1);
                else if (btn.id === 'btnZoomOut') this.zoom(-0.1);
                else if (btn.id === 'btnFit') this.fitToScreen();
                else if (btn.id === 'btnUndo') this.undo();
                else if (btn.id === 'btnRedo') this.redo();
                else if(tool) this.setTool(tool);
            });
        });

        window.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));
        
        // Use parentElement (canvas-area) for wheel zoom to work anywhere in the viewport
        this.wrapper.parentElement.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                this.zoom(delta);
            }
        });

        document.getElementById('btnDownload').addEventListener('click', this.download.bind(this));
        
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ') this.state.isSpacePressed = true;
            
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                if (e.shiftKey) this.redo();
                else this.undo();
                e.preventDefault();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                this.redo();
                e.preventDefault();
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedLayer && this.selectedLayer.type !== 'image') {
                    this.saveState(); 
                    this.layers = this.layers.filter(l => l !== this.selectedLayer);
                    this.selectedLayer = null;
                    this.render();
                    this.saveState(); 
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === ' ') this.state.isSpacePressed = false;
        });
    }

    zoom(delta) {
        this.viewport.scale = Math.max(0.1, Math.min(5, this.viewport.scale + delta));
        this.updateTransform();
    }

    setTool(tool) {
        if (this.activeTool === 'crop' && tool !== 'crop') {
            this.cropSelection = null;
            this.render();
        }
        
        // Don't deselect if just switching to Select tool to modify properties
        // But if switching FROM property editing, maybe?
        // Standard behavior: Changing tool deselects unless it's Select tool.
        
        if (tool !== 'select') {
            this.selectedLayer = null;
            this.layers.forEach(l => l.selected = false);
            this.resizingHandle = null;
            this.canvas.style.cursor = 'crosshair';
        } else {
             this.canvas.style.cursor = 'default';
        }

        this.activeTool = tool;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
        if (btn) btn.classList.add('active');
        
        this.updatePropertiesPanel();
        this.render();
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('tool-properties');
        panel.innerHTML = '';
        
        // Specific check for Blur tool
        if (this.activeTool === 'blur') {
             panel.innerHTML = '<div class="property-group default-msg">Blur Mode Active</div>';
             return;
        }
        
        let tmplId = '';
        let target = null; // What object are we modifying?

        // 1. Check Active Tool
        if (['rect', 'circle'].includes(this.activeTool)) {
            tmplId = 'tmpl-shape-props';
            target = this.props; // Modifying global defaults
        } else if (this.activeTool === 'crop') {
            tmplId = 'tmpl-crop-props';
        } else if (this.activeTool === 'select' && this.selectedLayer) {
            // 2. Check Selected Layer
            if (this.selectedLayer instanceof ShapeLayer) {
                tmplId = 'tmpl-shape-props';
                target = this.selectedLayer; // Modifying specific object
            }
        }
        
        if (!tmplId) {
            panel.innerHTML = '<div class="property-group default-msg">Select an object or tool</div>';
            return;
        }
        
        const clone = document.getElementById(tmplId).content.cloneNode(true);
        panel.appendChild(clone);
        
        if (this.activeTool === 'crop') {
             panel.querySelector('#btn-apply-crop').onclick = () => this.applyCrop();
             panel.querySelector('#btn-cancel-crop').onclick = () => {
                 this.cropSelection = null;
                 this.setTool('select');
             };
        }

        if (tmplId === 'tmpl-shape-props') {
            const stroke = panel.querySelector('#prop-stroke');
            const width = panel.querySelector('#prop-width');
            const widthVal = panel.querySelector('#prop-width-val');
            const fillCheck = panel.querySelector('#prop-fill-enabled');
            const fill = panel.querySelector('#prop-fill');
            
            // Initial Values
            if (target instanceof ShapeLayer) {
                stroke.value = target.stroke;
                width.value = target.strokeWidth;
                widthVal.textContent = target.strokeWidth + 'px';
                if (target.fill) {
                    fillCheck.checked = true;
                    fill.disabled = false;
                    fill.value = target.fill;
                }
            } else {
                stroke.value = this.props.color;
                width.value = this.props.strokeWidth;
                widthVal.textContent = this.props.strokeWidth + 'px';
                if (this.props.fill) {
                    fillCheck.checked = true;
                    fill.disabled = false;
                    fill.value = this.props.fill;
                }
            }
            
            // Events
            const updateTarget = (prop, value) => {
                if (target instanceof ShapeLayer) {
                    this.saveState(); // Save before change
                    target[prop] = value;
                    this.render();
                    this.saveState(); // Save after change
                } else {
                    // Updating defaults
                    if (prop === 'stroke') this.props.color = value;
                    if (prop === 'strokeWidth') this.props.strokeWidth = value;
                    if (prop === 'fill') this.props.fill = value;
                }
            };

            stroke.oninput = (e) => updateTarget('stroke', e.target.value);
            
            width.oninput = (e) => {
                const val = parseInt(e.target.value);
                widthVal.textContent = val + 'px';
                updateTarget('strokeWidth', val);
            };

            fillCheck.onchange = (e) => {
                fill.disabled = !e.target.checked;
                const val = e.target.checked ? fill.value : null;
                updateTarget('fill', val);
            };
            
            fill.oninput = (e) => updateTarget('fill', e.target.value);
        }
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / this.viewport.scale,
            y: (e.clientY - rect.top) / this.viewport.scale
        };
    }

    onMouseDown(e) {
        if (this.state.isSpacePressed) {
            this.state.isPanDragging = true;
            this.state.panStartX = e.clientX;
            this.state.panStartY = e.clientY;
            return;
        }

        // Ignore clicks on UI elements
        if (e.target.closest('.properties-bar') || e.target.closest('.tools-panel')) return;

        if (!e.target.closest('#canvas-wrapper') && this.activeTool !== 'crop') return;

        let pos = this.getMousePos(e);
        
        // Clamp for crop tool start
        if (this.activeTool === 'crop') {
            pos.x = Math.max(0, Math.min(pos.x, this.canvas.width));
            pos.y = Math.max(0, Math.min(pos.y, this.canvas.height));
        }

        this.state.isDragging = true;
        this.state.startX = pos.x;
        this.state.startY = pos.y;
        this.state.initialDragX = pos.x;
        this.state.initialDragY = pos.y;

        if (this.activeTool === 'select') {
            // Check Resize Handles first if an object is already selected
            if (this.selectedLayer && this.selectedLayer instanceof ShapeLayer) {
                const handle = this.selectedLayer.getHandleAt(pos.x, pos.y, this.viewport.scale);
                if (handle) {
                    this.resizingHandle = handle;
                    this.state.initialShapeState = {
                        x: this.selectedLayer.x,
                        y: this.selectedLayer.y,
                        w: this.selectedLayer.width,
                        h: this.selectedLayer.height
                    };
                    return; // Start resizing, don't select new object
                }
            }

            const clicked = this.layers.slice().reverse().find(l => l.contains(pos.x, pos.y) && l.selectable !== false);
            this.layers.forEach(l => l.selected = false);
            this.selectedLayer = clicked || null;
            
            if (this.selectedLayer) {
                this.selectedLayer.selected = true;
                // Move logic is handled in MouseMove
                this.updatePropertiesPanel(); // Update UI to show selection properties
            } else {
                this.updatePropertiesPanel(); // Clear UI if nothing selected
            }
            this.render();
        } else if (this.activeTool === 'crop') {
            this.cropSelection = { x: pos.x, y: pos.y, w: 0, h: 0 };
        } else if (['rect', 'circle', 'blur'].includes(this.activeTool)) {
            const type = this.activeTool;
            if (type === 'blur') {
                 this.currentLayer = { type: 'blur_selection', x: pos.x, y: pos.y, width: 0, height: 0 };
            } else {
                this.saveState(); // Save before drawing shape
                 this.currentLayer = new ShapeLayer(type, pos.x, pos.y, 0, 0, {
                    stroke: this.props.color,
                    strokeWidth: this.props.strokeWidth,
                    fill: this.props.fill
                });
                this.layers.push(this.currentLayer);
            }
        }
    }

    onMouseMove(e) {
        if (this.state.isPanDragging) {
            const dx = e.clientX - this.state.panStartX;
            const dy = e.clientY - this.state.panStartY;
            
            // Pan by scrolling the container
            const container = this.wrapper.parentElement;
            container.scrollLeft -= dx;
            container.scrollTop -= dy;

            this.state.panStartX = e.clientX;
            this.state.panStartY = e.clientY;
            return;
        }

        const pos = this.getMousePos(e);

        // Update Cursor for Resize Handles (Hover)
        if (this.activeTool === 'select' && !this.state.isDragging && this.selectedLayer && this.selectedLayer instanceof ShapeLayer) {
             const handle = this.selectedLayer.getHandleAt(pos.x, pos.y, this.viewport.scale);
             if (handle) {
                 this.canvas.style.cursor = this.selectedLayer.getHandles()[handle].cursor;
             } else {
                 // Check if over the object for move cursor?
                 // Or default
                 this.canvas.style.cursor = this.selectedLayer.contains(pos.x, pos.y) ? 'move' : 'default';
             }
        }

        if (!this.state.isDragging) return;
        
        const dx = pos.x - this.state.startX;
        const dy = pos.y - this.state.startY;

        if (this.activeTool === 'select') {
            if (this.resizingHandle && this.selectedLayer) {
                // Resize Logic
                if (!this.state.isResizing) {
                     this.saveState(); // Save before resize
                     this.state.isResizing = true;
                }
                
                const init = this.state.initialShapeState;
                const totalDx = pos.x - this.state.startX; // Delta from start of drag
                const totalDy = pos.y - this.state.startY;

                // Simple resize usage logic based on handle
                // This logic modifies x/y/w/h based on direction.
                // We use current position vs start position to calculate new rect.
                // Actually, cleaner to calculate based on absolute positions.
                
                // Let's rely on dx, dy (incremental) or total?
                // Total is safer usually.
                
                // Calculate new bounds
                let newX = init.x;
                let newY = init.y;
                let newW = init.w;
                let newH = init.h;

                // X Axis
                if (this.resizingHandle.includes('w')) {
                    newX = init.x + (pos.x - this.state.initialDragX);
                    newW = init.w - (pos.x - this.state.initialDragX);
                } else if (this.resizingHandle.includes('e')) {
                    newW = init.w + (pos.x - this.state.initialDragX);
                }

                // Y Axis
                if (this.resizingHandle.includes('n')) {
                    newY = init.y + (pos.y - this.state.initialDragY);
                    newH = init.h - (pos.y - this.state.initialDragY);
                } else if (this.resizingHandle.includes('s')) {
                    newH = init.h + (pos.y - this.state.initialDragY);
                }

                // Handle flipping
                /*
                if (newW < 0) {
                    newX += newW;
                    newW = Math.abs(newW);
                }
                if (newH < 0) {
                    newY += newH;
                    newH = Math.abs(newH);
                }
                */
                // Flipping slightly complicates the handle logic (e.g. 'e' becomes 'w').
                // Only allow positive width/height for now or normalize later?
                // Visual feedback is better if we update live.
                
                this.selectedLayer.x = newX;
                this.selectedLayer.y = newY;
                this.selectedLayer.width = newW;
                this.selectedLayer.height = newH;
                this.render();

            } else if (this.selectedLayer) {
                // Move Logic
                if (!this.state.isMovingObject) {
                    this.saveState();
                    this.state.isMovingObject = true;
                }
                this.selectedLayer.move(dx, dy);
                this.state.startX = pos.x;
                this.state.startY = pos.y;
                this.render();
            }
        } else if (this.activeTool === 'crop' && this.cropSelection) {
            // Clamp mouse pos to boundaries for display and selection
            const cx = Math.max(0, Math.min(pos.x, this.canvas.width));
            const cy = Math.max(0, Math.min(pos.y, this.canvas.height));
            
            this.cropSelection.w = cx - this.cropSelection.x;
            this.cropSelection.h = cy - this.cropSelection.y;
            
            const dimEl = document.getElementById('crop-dimensions');
            if (dimEl) {
                const w = Math.abs(this.cropSelection.w);
                const h = Math.abs(this.cropSelection.h);
                dimEl.textContent = `${Math.round(w)} x ${Math.round(h)} px`;
            }
            
            this.render();
        } else if (this.currentLayer) {
            if(this.currentLayer.type === 'blur_selection' || this.currentLayer instanceof ShapeLayer) {
                this.currentLayer.width = pos.x - this.state.startX;
                this.currentLayer.height = pos.y - this.state.startY;
                this.render();
            }
        }
    }

    onMouseUp(e) {
        this.state.isDragging = false;
        this.state.isPanDragging = false;
        
        if (this.state.isMovingObject) {
            this.state.isMovingObject = false; 
            this.saveState(); // Save end state of move
        }

        if (this.state.isResizing) {
            this.state.isResizing = false;
            this.resizingHandle = null;
            // Normalize Negative Sizes if any
            if(this.selectedLayer && (this.selectedLayer.width < 0 || this.selectedLayer.height < 0)) {
                 if (this.selectedLayer.width < 0) {
                    this.selectedLayer.x += this.selectedLayer.width;
                    this.selectedLayer.width = Math.abs(this.selectedLayer.width);
                }
                if (this.selectedLayer.height < 0) {
                    this.selectedLayer.y += this.selectedLayer.height;
                    this.selectedLayer.height = Math.abs(this.selectedLayer.height);
                }
            }
            this.render();
            this.saveState(); // Save end of resize
        }

        if (this.activeTool === 'rect' || this.activeTool === 'circle') {
            if (this.currentLayer) {
                // Normalize before saving final state
                if (this.currentLayer.width < 0) {
                    this.currentLayer.x += this.currentLayer.width;
                    this.currentLayer.width = Math.abs(this.currentLayer.width);
                }
                if (this.currentLayer.height < 0) {
                    this.currentLayer.y += this.currentLayer.height;
                    this.currentLayer.height = Math.abs(this.currentLayer.height);
                }
                this.saveState(); 
                this.currentLayer = null;
            }
        }

        // Handle Blur Logic
        if (this.activeTool === 'blur' && this.currentLayer && this.currentLayer.type === 'blur_selection') {
            const x = this.currentLayer.width > 0 ? this.currentLayer.x : this.currentLayer.x + this.currentLayer.width;
            const y = this.currentLayer.height > 0 ? this.currentLayer.y : this.currentLayer.y + this.currentLayer.height;
            const w = Math.abs(this.currentLayer.width);
            const h = Math.abs(this.currentLayer.height);
            
            this.currentLayer = null;

            if (w > 5 && h > 5) {
                this.saveState(); // Pre-blur
                this.createBlurLayer(x, y, w, h);
                this.saveState(); // Post-blur
            }
        }
    }

    createBlurLayer(x, y, w, h) {
        // Hide layer being edited to prevent blur loop? No, blur is new layer.
        
        x = Math.max(0, Math.min(x, this.canvas.width));
        y = Math.max(0, Math.min(y, this.canvas.height));
        w = Math.min(w, this.canvas.width - x);
        h = Math.min(h, this.canvas.height - y);

        if (w <= 0 || h <= 0) return;

        this.render(false); // Render without guides
        
        const imageData = this.ctx.getImageData(x, y, w, h);
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        const blockSize = 10;
        for (let py = 0; py < height; py += blockSize) {
            for (let px = 0; px < width; px += blockSize) {
                let r=0, g=0, b=0, count=0;
                for(let iy=0; iy<blockSize && py+iy<height; iy++) {
                    for(let ix=0; ix<blockSize && px+ix<width; ix++) {
                        const i = ((py + iy) * width + (px + ix)) * 4;
                        r += data[i];
                        g += data[i+1];
                        b += data[i+2];
                        count++;
                    }
                }
                r = Math.floor(r/count);
                g = Math.floor(g/count);
                b = Math.floor(b/count);
                for(let iy=0; iy < blockSize && py+iy < height; iy++) {
                    for(let ix=0; ix < blockSize && px+ix < width; ix++) {
                        const i = ((py + iy) * width + (px + ix)) * 4;
                        data[i] = r;
                        data[i+1] = g;
                        data[i+2] = b;
                    }
                }
            }
        }
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(imageData, 0, 0);
        
        const layer = new ImageLayer(tempCanvas, x, y);
        this.layers.push(layer);
        
        this.render();
    }

    applyCrop() {
        if (!this.cropSelection) return;
        
        this.saveState(); // Pre-crop

        let { x, y, w, h } = this.cropSelection;
        if (w < 0) { x += w; w = Math.abs(w); }
        if (h < 0) { y += h; h = Math.abs(h); }
        
        if (w < 10 || h < 10) return;

        this.canvas.width = w;
        this.canvas.height = h;
        
        this.layers.forEach(layer => {
            layer.move(-x, -y);
        });
        
        this.cropSelection = null;
        this.setTool('select');
        this.fitToScreen();
        
        this.saveState(); // Post-crop
    }

    render(drawGuides = true) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.layers.forEach(layer => layer.draw(this.ctx));
        
        if (this.activeTool === 'crop' && this.cropSelection && drawGuides) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.beginPath();
            this.ctx.rect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.rect(this.cropSelection.x, this.cropSelection.y, this.cropSelection.w, this.cropSelection.h);
            this.ctx.globalCompositeOperation = 'source-over'; 
            this.ctx.fill('evenodd');
            
            this.ctx.strokeStyle = '#fff';
            this.ctx.setLineDash([5, 5]);
            this.ctx.lineWidth = 2 / this.viewport.scale;
            this.ctx.strokeRect(this.cropSelection.x, this.cropSelection.y, this.cropSelection.w, this.cropSelection.h);
            this.ctx.restore();
        }

        if (this.activeTool === 'blur' && this.currentLayer && this.currentLayer.type === 'blur_selection' && drawGuides) {
             this.ctx.save();
             this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
             this.ctx.strokeStyle = '#000';
             this.ctx.lineWidth = 1/this.viewport.scale;
             this.ctx.fillRect(this.currentLayer.x, this.currentLayer.y, this.currentLayer.width, this.currentLayer.height);
             this.ctx.strokeRect(this.currentLayer.x, this.currentLayer.y, this.currentLayer.width, this.currentLayer.height);
             this.ctx.restore();
        }
    }

    download() {
        const link = document.createElement('a');
        link.download = `indigo-screenshot-${Date.now()}.png`;
        
        const wasSelected = this.selectedLayer;
        if(wasSelected) {
            wasSelected.selected = false;
            this.render();
        }
        
        link.href = this.canvas.toDataURL();
        link.click();
        
        if(wasSelected) {
            wasSelected.selected = true;
            this.render();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.editor = new Editor();
});
