// Minimal guided tour used by the demo page (replaces intro.js).
//
// A step is { element, content, className }:
//   element:   CSS selector of the element to highlight (optional)
//   content:   () => paragraphs, where a paragraph is an array of items and an
//              item is a plain string or { cls: 'css classes' } (an icon span).
//              Content is built with DOM APIs only (no innerHTML).
//   className: extra class for the tooltip, used for per-step placement in CSS.
//   highlight: true to dim everything except `element`
//   place:     optional (tooltip, rect) => void for dynamic placement

function Tour(steps) {
	this.steps = steps;
	this.current = 0;			// 1-based number of the current step, 0 = not showing
	this.active = false;
	this._onResize = () => this.active && this._render();
}

Tour.prototype.start = function() {
	this.active = true;
	window.addEventListener('resize', this._onResize);
	this.goToStep(1);
};

Tour.prototype.exit = function() {
	this.active = false;
	window.removeEventListener('resize', this._onResize);
	if(this.tooltip) this.tooltip.remove();
	if(this.highlight) this.highlight.remove();
	this.tooltip = this.highlight = null;
};

Tour.prototype.goToStep = function(n) {
	if(n < 1 || n > this.steps.length)
		return;
	this.current = n;
	this._render();
};

// Called after each step is shown, so the page can enable/disable "Next" etc.
Tour.prototype.onchange = null;

Tour.prototype.setNextEnabled = function(enabled) {
	if(!this.tooltip) return;
	const btn = this.tooltip.querySelector('.tour-next');
	btn.disabled = !enabled;
};

function buildContent(paragraphs) {
	const frag = document.createDocumentFragment();
	paragraphs.forEach(function(items) {
		const p = document.createElement('p');
		items.forEach(function(item) {
			if(typeof item === 'string') {
				p.appendChild(document.createTextNode(item));
			} else {
				const span = document.createElement('span');
				span.className = item.cls;
				p.appendChild(span);
			}
		});
		frag.appendChild(p);
	});
	return frag;
}

Tour.prototype._render = function() {
	if(this.tooltip) this.tooltip.remove();
	if(this.highlight) this.highlight.remove();
	this.tooltip = this.highlight = null;

	const step = this.steps[this.current - 1];
	const last = this.current === this.steps.length;
	const target = step.element && document.querySelector(step.element);
	const rect = target && target.getBoundingClientRect();

	if(step.highlight && rect) {
		const h = document.createElement('div');
		h.className = 'tour-highlight';
		h.style.left = rect.left + 'px';
		h.style.top = rect.top + 'px';
		h.style.width = rect.width + 'px';
		h.style.height = rect.height + 'px';
		document.body.appendChild(h);
		this.highlight = h;
	}

	const tip = document.createElement('div');
	tip.className = 'tour-tooltip ' + (step.className || '');
	const text = document.createElement('div');
	text.className = 'tour-text';
	text.appendChild(buildContent(step.content()));
	tip.appendChild(text);

	const buttons = document.createElement('div');
	buttons.className = 'tour-buttons';
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'tour-btn tour-close';
	close.textContent = 'Close';
	close.addEventListener('click', () => this.exit());
	const next = document.createElement('button');
	next.type = 'button';
	next.className = 'tour-btn tour-next';
	next.textContent = 'Next →';
	next.addEventListener('click', () => this.goToStep(this.current + 1));
	// Close is only offered at the end, Next on every other step
	if(last) buttons.appendChild(close); else buttons.appendChild(next);
	tip.appendChild(buttons);

	document.body.appendChild(tip);
	this.tooltip = tip;
	if(step.place && rect) step.place(tip, rect);

	if(this.onchange) this.onchange(this.current);
};

module.exports = Tour;
