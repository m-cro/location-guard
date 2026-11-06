// Tiny DOM helpers + side menu behaviour shared by the extension pages.
// (Replaces jQuery / jQuery Mobile.)

const byId = id => document.getElementById(id);

// h('p', {class: 'x'}, 'text', childNode, ...) -> element (no innerHTML)
function h(tag, attrs, ...children) {
	const el = document.createElement(tag);
	for(const k in (attrs || {}))
		el.setAttribute(k, attrs[k]);
	for(const c of children)
		el.append(c);		// strings become text nodes
	return el;
}

const isWide = () => window.matchMedia('(min-width: 50em)').matches;

// Side menu: opened with the header button or by swiping right, closed by
// clicking outside it or on one of its links. On wide screens it is always shown.
function initPanel() {
	const panel = byId('left-panel');
	if(!panel) return;

	const backdrop = h('div', { class: 'panel-backdrop' });
	backdrop.hidden = true;
	document.body.append(backdrop);

	const open = () => {
		if(isWide()) return;
		panel.classList.add('open');
		backdrop.hidden = false;
	};
	const close = () => {
		panel.classList.remove('open');
		backdrop.hidden = true;
	};

	for(const btn of document.querySelectorAll('.menu-btn'))
		btn.addEventListener('click', open);
	backdrop.addEventListener('click', close);
	panel.addEventListener('click', e => { if(e.target.closest('a')) close(); });

	let startX = null, startY = null;
	document.addEventListener('touchstart', e => {
		startX = e.touches[0].clientX;
		startY = e.touches[0].clientY;
	}, { passive: true });
	document.addEventListener('touchend', e => {
		if(startX === null) return;
		const t = e.changedTouches[0];
		if(t.clientX - startX > 60 && Math.abs(t.clientY - startY) < 40)
			open();
		startX = null;
	}, { passive: true });

	return { open, close };
}

module.exports = { byId, h, initPanel, isWide };
