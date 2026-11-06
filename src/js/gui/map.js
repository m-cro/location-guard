// Base layers used by the options and demo maps. The local grid makes the
// maps usable without contacting any tile provider.
const L = require('leaflet');
const Browser = require('../common/browser');

function addLocalGrid(map) {
	const GridLayer = L.GridLayer.extend({
		createTile: function(coords) {
			const tile = document.createElement('canvas');
			const size = this.getTileSize();
			tile.width = size.x;
			tile.height = size.y;
			const ctx = tile.getContext('2d');
			const worldSize = 256 * Math.pow(2, coords.z);
			const left = coords.x * size.x;
			const top = coords.y * size.y;
			const step = 30 / Math.pow(2, Math.max(0, coords.z - 2));
			const decimals = Math.max(0, Math.ceil(-Math.log10(step)));

			ctx.fillStyle = '#f3f6f7';
			ctx.fillRect(0, 0, size.x, size.y);
			ctx.strokeStyle = '#cbd5d9';
			ctx.lineWidth = 1;
			ctx.fillStyle = '#56666d';
			ctx.font = '12px sans-serif';
			ctx.textBaseline = 'top';
			ctx.beginPath();

			const minLongitude = left / worldSize * 360 - 180;
			const maxLongitude = (left + size.x) / worldSize * 360 - 180;
			for(let longitude = Math.floor(minLongitude / step) * step; longitude <= maxLongitude; longitude += step) {
				const x = (longitude + 180) / 360 * worldSize - left;
				if(x < -1 || x > size.x + 1) continue;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, size.y);
				ctx.fillText(longitude.toFixed(decimals) + '°', x + 3, 3);
			}

			function latitudeAt(y) {
				return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / worldSize))) * 180 / Math.PI;
			}
			const highLatitude = Math.min(85, latitudeAt(top));
			const lowLatitude = Math.max(-85, latitudeAt(top + size.y));
			for(let latitude = Math.floor(lowLatitude / step) * step; latitude <= highLatitude; latitude += step) {
				const sin = Math.sin(latitude * Math.PI / 180);
				const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize - top;
				if(y < -1 || y > size.y + 1) continue;
				ctx.moveTo(0, y);
				ctx.lineTo(size.x, y);
				ctx.fillText(latitude.toFixed(decimals) + '°', 3, y + 3);
			}

			ctx.stroke();
			return tile;
		}
	});

	return new GridLayer({ attribution: 'Local coordinate grid' }).addTo(map);
}

async function addBaseLayer(map) {
	if(map._locationGuardBaseLayer) map.removeLayer(map._locationGuardBaseLayer);
	if(map._locationGuardOfflineNotice) map.removeControl(map._locationGuardOfflineNotice);
	const tiles = await Browser.gui.mapTiles();
	if(tiles) {
		map._locationGuardBaseLayer = new L.TileLayer(tiles.url, tiles.info).addTo(map);
	} else {
		map._locationGuardBaseLayer = addLocalGrid(map);
		const noticeControl = L.control({ position: 'bottomleft' });
		noticeControl.onAdd = function() {
			const notice = L.DomUtil.create('div', 'map-offline-note');
			notice.textContent = 'Offline grid. Configure map tiles in Options.';
			return notice;
		};
		map._locationGuardOfflineNotice = noticeControl.addTo(map);
	}
}

module.exports = { addBaseLayer };
