const Browser = require('../common/browser');
const { byId, initPanel } = require('./ui');

Browser.log("faq loading");

// send an empty reply to getState (see options.js)
Browser.init('options');
Browser.rpc.register('getState', function(tabId) {
	return null;
});

const sections = () => Array.from(document.querySelectorAll('#faq details'));

function openHash() {
	const target = byId("faq-" + location.hash.substr(1));
	if(target) target.open = true;
}

document.addEventListener('DOMContentLoaded', function() {
	initPanel();

	// accordion: opening a question closes the others, and puts its name in the url
	for(const d of sections()) {
		d.addEventListener('toggle', function() {
			if(!d.open) return;
			for(const other of sections())
				if(other !== d) other.open = false;
			location.hash = "#" + d.id.substr(4);
		});
	}

	byId('lgIcon').classList.add(Browser.capabilities.permanentIcon() ? 'lg-icon-browseraction' : 'lg-icon-pageaction');

	window.addEventListener("hashchange", openHash);

	if(location.hash)
		openHash();
	else
		location.hash = "#general";
});
