// Base layers used by the options and demo maps. The local grid makes the
// maps usable without contacting any tile provider.
const Browser = require('../common/browser');
const { urlTileLayer, gridTileLayer } = require('./minimap');

async function addBaseLayer(map) {
	if(map._locationGuardBaseLayer) map._locationGuardBaseLayer.remove();
	if(map._locationGuardOfflineNotice) map._locationGuardOfflineNotice.remove();
	map._locationGuardOfflineNotice = null;

	const tiles = await Browser.gui.mapTiles();
	if(tiles) {
		map._locationGuardBaseLayer = urlTileLayer(tiles.url).addTo(map);
		map.setAttribution(tiles.attribution, tiles.attributionUrl);
	} else {
		map._locationGuardBaseLayer = gridTileLayer().addTo(map);
		map.setAttribution('Local coordinate grid');
		map._locationGuardOfflineNotice = map.addNotice('Offline grid. Configure map tiles in Options.');
	}
}

module.exports = { addBaseLayer };
