// A small slippy map (Web Mercator tiles, circles, markers, one popup).
// It only implements what the options and demo pages need, and replaces Leaflet.
// Coordinates are plain { lat, lng } objects (arrays [lat, lng] are accepted as input).

const TILE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const MAX_LAT = 85.0511287798;
const EARTH_CIRCUMFERENCE = 40075016.686;		// meters

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapLng = lng => ((lng + 180) % 360 + 360) % 360 - 180;

function toLatLng(v) {
	return Array.isArray(v) ? { lat: v[0], lng: v[1] } : { lat: v.lat, lng: v.lng };
}

// world pixel coordinates at zoom z
function project(ll, z) {
	const scale = TILE * Math.pow(2, z);
	const sin = Math.sin(clamp(ll.lat, -MAX_LAT, MAX_LAT) * Math.PI / 180);
	return {
		x: (ll.lng + 180) / 360 * scale,
		y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
	};
}

function unproject(pt, z) {
	const scale = TILE * Math.pow(2, z);
	return {
		lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * pt.y / scale))) * 180 / Math.PI,
		lng: pt.x / scale * 360 - 180,
	};
}

const metersPerPixel = (lat, z) => EARTH_CIRCUMFERENCE * Math.cos(lat * Math.PI / 180) / (TILE * Math.pow(2, z));

function el(tag, className, parent) {
	const e = document.createElement(tag);
	if(className) e.className = className;
	if(parent) parent.appendChild(e);
	return e;
}

class Emitter {
	on(name, fn) {
		this._handlers = this._handlers || {};
		(this._handlers[name] = this._handlers[name] || []).push(fn);
		return this;
	}
	emit(name, e) {
		for(const fn of (this._handlers && this._handlers[name]) || [])
			fn(Object.assign({ target: this }, e));
	}
}

class Bounds {
	constructor(south, west, north, east) {
		this.south = south; this.west = west; this.north = north; this.east = east;
	}
	getSouth() { return this.south; }
	getCenter() { return { lat: (this.south + this.north) / 2, lng: (this.west + this.east) / 2 }; }
}

// ---------------------------------------------------------------- tiles

// Base layer made of tile elements. `create(z, x, y)` returns a 256x256 element.
class TileLayer {
	constructor(create) {
		this.create = create;
		this.tiles = new Map();
	}

	addTo(map) {
		this.map = map;
		this.pane = map.tilePane;
		map.baseLayer = this;
		map.render();
		return this;
	}

	remove() {
		for(const t of this.tiles.values()) t.remove();
		this.tiles.clear();
		if(this.map && this.map.baseLayer === this) this.map.baseLayer = null;
	}

	update() {
		const map = this.map, z = map.zoom, n = Math.pow(2, z), o = map.origin;
		const x0 = Math.floor(o.x / TILE), x1 = Math.floor((o.x + map.size.x) / TILE);
		const y0 = Math.max(0, Math.floor(o.y / TILE)), y1 = Math.min(n - 1, Math.floor((o.y + map.size.y) / TILE));

		const wanted = new Set();
		for(let x = x0; x <= x1; x++) {
			for(let y = y0; y <= y1; y++) {
				const key = z + '/' + x + '/' + y;
				wanted.add(key);
				let tile = this.tiles.get(key);
				if(!tile) {
					tile = this.create(z, ((x % n) + n) % n, y);
					tile.className = 'gm-tile';
					this.pane.appendChild(tile);
					this.tiles.set(key, tile);
				}
				tile.style.transform = 'translate(' + (x * TILE - o.x) + 'px,' + (y * TILE - o.y) + 'px)';
			}
		}
		for(const [key, tile] of this.tiles) {
			if(!wanted.has(key)) {
				tile.remove();
				this.tiles.delete(key);
			}
		}
	}
}

// tiles from an https url template like https://tiles.example/{z}/{x}/{y}.png
function urlTileLayer(template) {
	return new TileLayer(function(z, x, y) {
		const img = new Image(TILE, TILE);
		img.alt = '';
		img.draggable = false;
		img.src = template
			.replace('{s}', 'abc'[(x + y) % 3])
			.replace('{r}', '')
			.replace('{z}', z).replace('{x}', x).replace('{y}', y);
		return img;
	});
}

// offline layer: a labelled lat/lng grid, drawn locally
function gridTileLayer() {
	return new TileLayer(function(z, x, y) {
		const tile = document.createElement('canvas');
		tile.width = TILE;
		tile.height = TILE;
		const ctx = tile.getContext('2d');
		const worldSize = TILE * Math.pow(2, z);
		const left = x * TILE;
		const top = y * TILE;
		const step = 30 / Math.pow(2, Math.max(0, z - 2));
		const decimals = Math.max(0, Math.ceil(-Math.log10(step)));

		ctx.fillStyle = '#f3f6f7';
		ctx.fillRect(0, 0, TILE, TILE);
		ctx.strokeStyle = '#cbd5d9';
		ctx.lineWidth = 1;
		ctx.fillStyle = '#56666d';
		ctx.font = '12px sans-serif';
		ctx.textBaseline = 'top';
		ctx.beginPath();

		const minLongitude = left / worldSize * 360 - 180;
		const maxLongitude = (left + TILE) / worldSize * 360 - 180;
		for(let longitude = Math.floor(minLongitude / step) * step; longitude <= maxLongitude; longitude += step) {
			const px = (longitude + 180) / 360 * worldSize - left;
			if(px < -1 || px > TILE + 1) continue;
			ctx.moveTo(px, 0);
			ctx.lineTo(px, TILE);
			ctx.fillText(longitude.toFixed(decimals) + '°', px + 3, 3);
		}

		const highLatitude = Math.min(85, unproject({ x: 0, y: top }, z).lat);
		const lowLatitude = Math.max(-85, unproject({ x: 0, y: top + TILE }, z).lat);
		for(let latitude = Math.floor(lowLatitude / step) * step; latitude <= highLatitude; latitude += step) {
			const py = project({ lat: latitude, lng: 0 }, z).y - top;
			if(py < -1 || py > TILE + 1) continue;
			ctx.moveTo(0, py);
			ctx.lineTo(TILE, py);
			ctx.fillText(latitude.toFixed(decimals) + '°', 3, py + 3);
		}

		ctx.stroke();
		return tile;
	});
}

// ---------------------------------------------------------------- overlays

class Circle {
	constructor(latlng, radius, style) {
		this.latlng = toLatLng(latlng);
		this.radius = radius;
		this.style = style || {};
	}
	addTo(map) { this.map = map; map.circles.push(this); map.render(); return this; }
	setLatLng(ll) { this.latlng = toLatLng(ll); this.map && this.map.render(); return this; }
	setRadius(r) { this.radius = r; this.map && this.map.render(); return this; }
	getBounds() {
		const dLat = this.radius / 111320;
		const dLng = this.radius / (111320 * Math.cos(this.latlng.lat * Math.PI / 180));
		return new Bounds(this.latlng.lat - dLat, this.latlng.lng - dLng, this.latlng.lat + dLat, this.latlng.lng + dLng);
	}
	draw(ctx, map) {
		const p = map.latLngToPoint(this.latlng);
		const r = this.radius / metersPerPixel(this.latlng.lat, map.zoom);
		const s = this.style;
		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
		if(s.fillColor) {
			ctx.globalAlpha = s.fillOpacity == null ? 0.2 : s.fillOpacity;
			ctx.fillStyle = s.fillColor;
			ctx.fill();
		}
		if(s.color) {
			ctx.globalAlpha = s.opacity == null ? 1 : s.opacity;
			ctx.strokeStyle = s.color;
			ctx.lineWidth = s.weight == null ? 3 : s.weight;
			ctx.stroke();
		}
	}
}

class Marker extends Emitter {
	constructor(latlng, opts) {
		super();
		this._latlng = toLatLng(latlng);
		this.draggable = !!(opts && opts.draggable);
		this.el = el('div', 'gm-marker');
		this.el.addEventListener('pointerdown', e => this._pointerDown(e));
	}
	addTo(map) {
		this.map = map;
		map.markerPane.appendChild(this.el);
		map.markers.push(this);
		map.render();
		return this;
	}
	getLatLng() { return this._latlng; }
	setLatLng(ll) { this._latlng = toLatLng(ll); this.map && this.map.render(); return this; }

	_pointerDown(e) {
		if(e.pointerType === 'mouse' && e.button !== 0) return;
		e.stopPropagation();		// don't pan the map
		e.preventDefault();
		const map = this.map;
		const start = map.eventPoint(e);
		const anchor = map.latLngToPoint(this._latlng);
		let moved = false;
		this.el.setPointerCapture(e.pointerId);

		const move = ev => {
			const p = map.eventPoint(ev);
			if(!moved && Math.hypot(p.x - start.x, p.y - start.y) < 3) return;
			moved = true;
			if(!this.draggable) return;
			this._latlng = map.pointToLatLng({ x: anchor.x + p.x - start.x, y: anchor.y + p.y - start.y });
			map.render();
			this.emit('drag', { latlng: this._latlng });
		};
		const up = () => {
			this.el.removeEventListener('pointermove', move);
			this.el.removeEventListener('pointerup', up);
			this.el.removeEventListener('pointercancel', up);
			if(!moved) this.emit('click', { latlng: this._latlng });
			else if(this.draggable) this.emit('dragend', { latlng: this._latlng });
		};
		this.el.addEventListener('pointermove', move);
		this.el.addEventListener('pointerup', up);
		this.el.addEventListener('pointercancel', up);
	}
}

class Popup {
	constructor(opts) {
		this.maxWidth = (opts && opts.maxWidth) || 300;
		this.showTip = true;
		this.open = false;
		this.el = el('div', 'gm-popup');
		this.content = el('div', 'gm-popup-content', this.el);
		this.closeBtn = el('a', 'gm-popup-close', this.el);
		this.closeBtn.href = '#';
		this.closeBtn.textContent = '×';
		this.tip = el('div', 'gm-popup-tip', this.el);
		this.closeBtn.addEventListener('click', e => { e.preventDefault(); this.close(); });
		for(const type of ['pointerdown', 'dblclick', 'wheel'])
			this.el.addEventListener(type, e => e.stopPropagation());
		this.el.style.maxWidth = this.maxWidth + 'px';
	}
	setContent(node) { this.content.replaceChildren(node); return this; }
	setLatLng(ll) { this.latlng = toLatLng(ll); this.map && this.map.render(); return this; }
	setTip(visible) { this.tip.style.visibility = visible ? 'visible' : 'hidden'; return this; }
	isOpen() { return this.open; }
	openOn(map) {
		this.map = map;
		map.closePopup();
		map.popup = this;
		map.popupPane.appendChild(this.el);
		this.open = true;
		map.render();
		return this;
	}
	close() {
		if(!this.open) return;
		this.open = false;
		this.el.remove();
		if(this.map && this.map.popup === this) this.map.popup = null;
	}
}

// ---------------------------------------------------------------- map

class GeoMap extends Emitter {
	constructor(container) {
		super();
		this.el = typeof container === 'string' ? document.getElementById(container) : container;
		this.el.classList.add('gm-map');
		this.center = { lat: 0, lng: 0 };
		this.zoom = 2;
		this.size = { x: 0, y: 0 };
		this.origin = { x: 0, y: 0 };
		this.circles = [];
		this.markers = [];
		this.popup = null;
		this.baseLayer = null;

		this.tilePane = el('div', 'gm-tiles', this.el);
		this.canvas = el('canvas', 'gm-overlay', this.el);
		this.markerPane = el('div', 'gm-markers', this.el);
		this.popupPane = el('div', 'gm-popups', this.el);
		this.topLeft = el('div', 'gm-ctrl gm-ctrl-tl', this.el);
		this.bottomLeft = el('div', 'gm-ctrl-bl', this.el);
		this.attribution = el('div', 'gm-attribution', this.el);

		this._addZoomControl();
		this._initInteraction();

		if(typeof ResizeObserver !== 'undefined')
			new ResizeObserver(() => this.invalidateSize()).observe(this.el);
		this.invalidateSize();
	}

	// ---- view
	setView(ll, zoom) {
		this.center = toLatLng(ll);
		if(zoom != null) this.zoom = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
		this.render();
		return this;
	}

	fitBounds(b) {
		let z = MIN_ZOOM;
		if(this.size.x && this.size.y) {
			for(z = MAX_ZOOM; z > MIN_ZOOM; z--) {
				const sw = project({ lat: b.south, lng: b.west }, z), ne = project({ lat: b.north, lng: b.east }, z);
				if(ne.x - sw.x <= this.size.x && sw.y - ne.y <= this.size.y) break;
			}
		}
		const sw = project({ lat: b.south, lng: b.west }, z), ne = project({ lat: b.north, lng: b.east }, z);
		this.center = unproject({ x: (sw.x + ne.x) / 2, y: (sw.y + ne.y) / 2 }, z);
		this.zoom = z;
		this.render();
		return this;
	}

	getBounds() {
		const nw = this.pointToLatLng({ x: 0, y: 0 }), se = this.pointToLatLng({ x: this.size.x, y: this.size.y });
		return new Bounds(se.lat, nw.lng, nw.lat, se.lng);
	}

	invalidateSize() {
		this.size = { x: this.el.clientWidth, y: this.el.clientHeight };
		this.render();
		return this;
	}

	zoomBy(delta, anchor) {
		const z = clamp(this.zoom + delta, MIN_ZOOM, MAX_ZOOM);
		if(z === this.zoom) return;
		anchor = anchor || { x: this.size.x / 2, y: this.size.y / 2 };
		const ratio = Math.pow(2, z - this.zoom);
		const world = { x: (this.origin.x + anchor.x) * ratio, y: (this.origin.y + anchor.y) * ratio };
		this.zoom = z;
		this.center = unproject({ x: world.x - anchor.x + this.size.x / 2, y: world.y - anchor.y + this.size.y / 2 }, z);
		this.render();
	}

	// ---- coordinate conversion (points are relative to the map container)
	latLngToPoint(ll) {
		const p = project(ll, this.zoom);
		return { x: p.x - this.origin.x, y: p.y - this.origin.y };
	}
	pointToLatLng(pt) {
		const ll = unproject({ x: pt.x + this.origin.x, y: pt.y + this.origin.y }, this.zoom);
		return { lat: ll.lat, lng: wrapLng(ll.lng) };
	}
	eventPoint(e) {
		const r = this.el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	// ---- layers / controls
	closePopup() {
		if(this.popup) this.popup.close();
		return this;
	}

	setAttribution(text, url) {
		this.attribution.replaceChildren();
		if(!text) return;
		if(url) {
			const a = el('a', null, this.attribution);
			a.href = url;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = text;
		} else {
			this.attribution.textContent = text;
		}
	}

	addNotice(text) {
		const n = el('div', 'map-offline-note', this.bottomLeft);
		n.textContent = text;
		return n;
	}

	// small square button below the zoom buttons
	addButton(className, title, onClick) {
		const group = el('div', 'gm-ctrl-group', this.topLeft);
		const a = el('a', className, group);
		a.href = '#';
		a.title = title;
		a.addEventListener('click', e => { e.preventDefault(); onClick(); });
		return a;
	}

	_addZoomControl() {
		const group = el('div', 'gm-ctrl-group', this.topLeft);
		for(const [label, title, delta] of [['+', 'Zoom in', 1], ['−', 'Zoom out', -1]]) {
			const a = el('a', 'gm-zoom', group);
			a.href = '#';
			a.title = title;
			a.textContent = label;
			a.addEventListener('click', e => { e.preventDefault(); this.zoomBy(delta); });
		}
		for(const type of ['pointerdown', 'dblclick', 'wheel'])
			this.topLeft.addEventListener(type, e => e.stopPropagation());
	}

	// ---- rendering
	render() {
		if(!this.size.x || !this.size.y) return;
		const c = project(this.center, this.zoom);
		this.origin = { x: Math.round(c.x - this.size.x / 2), y: Math.round(c.y - this.size.y / 2) };

		if(this.baseLayer) this.baseLayer.update();

		const dpr = window.devicePixelRatio || 1;
		const cv = this.canvas;
		if(cv.width !== this.size.x * dpr || cv.height !== this.size.y * dpr) {
			cv.width = this.size.x * dpr;
			cv.height = this.size.y * dpr;
			cv.style.width = this.size.x + 'px';
			cv.style.height = this.size.y + 'px';
		}
		const ctx = cv.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, this.size.x, this.size.y);
		for(const circle of this.circles) {
			ctx.save();
			circle.draw(ctx, this);
			ctx.restore();
		}

		for(const m of this.markers) {
			const p = this.latLngToPoint(m._latlng);
			m.el.style.transform = 'translate(' + Math.round(p.x - 12) + 'px,' + Math.round(p.y - 41) + 'px)';
		}

		if(this.popup && this.popup.latlng) {
			const p = this.latLngToPoint(this.popup.latlng);
			this.popup.el.style.transform = 'translate(calc(' + Math.round(p.x) + 'px - 50%), calc(' + Math.round(p.y) + 'px - 100% - 12px))';
		}
	}

	// ---- mouse / touch
	_initInteraction() {
		const pointers = new Map();
		let drag = null, pinch = null, lastWheel = 0;

		this.el.addEventListener('pointerdown', e => {
			if(e.pointerType === 'mouse' && e.button !== 0) return;
			this.el.setPointerCapture(e.pointerId);
			pointers.set(e.pointerId, this.eventPoint(e));
			if(pointers.size === 1) {
				drag = { start: this.eventPoint(e), center: project(this.center, this.zoom), moved: false };
			} else if(pointers.size === 2) {
				const [a, b] = Array.from(pointers.values());
				pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
				drag = null;
			}
		});

		this.el.addEventListener('pointermove', e => {
			if(!pointers.has(e.pointerId)) return;
			pointers.set(e.pointerId, this.eventPoint(e));
			if(drag) {
				const p = this.eventPoint(e);
				const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
				if(!drag.moved && Math.hypot(dx, dy) >= 3) {
					drag.moved = true;
					this.emit('dragstart', {});
				}
				if(drag.moved) {
					const c = unproject({ x: drag.center.x - dx, y: drag.center.y - dy }, this.zoom);
					this.center = { lat: clamp(c.lat, -MAX_LAT, MAX_LAT), lng: c.lng };
					this.render();
				}
			}
		});

		const end = e => {
			if(!pointers.has(e.pointerId)) return;
			const p = this.eventPoint(e);
			pointers.delete(e.pointerId);
			if(pinch) {
				// zoom once the pinch is over, by the (rounded) change of the distance between the fingers
				const rest = Array.from(pointers.values())[0];
				if(rest) {
					const dist = Math.hypot(p.x - rest.x, p.y - rest.y);
					this.zoomBy(Math.round(Math.log2(Math.max(dist, 1) / Math.max(pinch.dist, 1))), pinch.mid);
				}
				pinch = null;
			} else if(drag) {
				if(!drag.moved && e.type === 'pointerup')
					this.emit('click', { latlng: this.pointToLatLng(p) });
				drag = null;
			}
		};
		this.el.addEventListener('pointerup', end);
		this.el.addEventListener('pointercancel', end);

		this.el.addEventListener('wheel', e => {
			e.preventDefault();
			const now = Date.now();
			if(now - lastWheel < 200) return;
			lastWheel = now;
			this.zoomBy(e.deltaY < 0 ? 1 : -1, this.eventPoint(e));
		}, { passive: false });

		this.el.addEventListener('dblclick', e => this.zoomBy(1, this.eventPoint(e)));
	}
}

module.exports = { GeoMap, Circle, Marker, Popup, TileLayer, urlTileLayer, gridTileLayer, wrapLng };
