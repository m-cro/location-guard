const Browser = require('../common/browser');
const Util = require('../common/util');

Browser.log("popup loading");

Browser.init('popup');

const { byId } = require('./ui');

document.addEventListener('DOMContentLoaded', drawUI);


var url;

async function doAction(e) {
	e.preventDefault();
	var action = this.id;

	switch(action) {
		case 'options':
		case 'faq':
			var page = action == 'options' ? 'options.html' : 'faq.html#general';

			if(Browser.capabilities.popupAsTab()) {
				// we're in a normal tab, just navigate to the page
				window.location.href = page;
			} else {
				Browser.gui.showPage(page);
				Browser.gui.closePopup();
			}
			break;

		case 'hideIcon':
			var st = await Browser.storage.get();
			st.hideIcon = true;
			await Browser.storage.set(st);
			await Browser.gui.refreshAllIcons();
			Browser.gui.closePopup();
			break;

		case 'pause':
			var st = await Browser.storage.get();
			st.paused = !st.paused;
			await Browser.storage.set(st);
			await Browser.gui.refreshAllIcons();
			Browser.gui.closePopup();
			break;

		case 'setLevel':
			byId("levels").hidden = false;
			break;

		default:	// set level
			if(!url) throw "no url";				// just to be sure

			var st = await Browser.storage.get();
			var domain = Util.extractDomain(url);
			var level = action;
			if(level == st.defaultLevel)
				delete st.domainLevel[domain];
			else
				st.domainLevel[domain] = level;

			await Browser.storage.set(st);
			await Browser.gui.refreshAllIcons();
			Browser.gui.closePopup();
			break;
	}
}

async function drawUI() {
	var res = window.location.href.match(/tabId=(\d+)/);
	var tabId = res ? parseInt(res[1]) : null;

	// we need storage and url
	const callUrl = await Browser.gui.getCallUrl(tabId);
	const st = await Browser.storage.get();
	Browser.log("popup: callUrl", callUrl, "settings", st);

	// we don't have a url if we are in chrome (browser action, visible in
	// all tabs), and the active tab has no content-script running (eg. new
	// tab page)
	//
	if(callUrl) {
		url = callUrl;
		var domain = Util.extractDomain(url);
		var level = st.domainLevel[domain] || st.defaultLevel;

		byId("title").textContent =
			st.paused		? "Location Guard is paused" :
			level == 'real'	? "Using your real location" :
			level == 'fixed'? "Using a fixed location" :
			"Privacy level: " + level;
		document.querySelector("#setLevel b").textContent = domain;
		byId(level).checked = true;

	} else {
		byId("title").parentElement.hidden = true;
	}

	byId("pause").textContent = (st.paused ? "Resume" : "Pause") + " Location Guard";
	byId("pauseItem").className = st.paused ? "icon-play" : "icon-pause";

	byId("setLevel").parentElement.hidden = !(callUrl && !st.paused);
	// hiding the icon only works with page action (not browser action)
	byId("hideIcon").parentElement.hidden = !(callUrl && !st.paused && !Browser.capabilities.permanentIcon());

	for(const el of document.querySelectorAll("#container a, #container input"))
		el.addEventListener("click", doAction);

	// clicking anywhere else closes the level chooser
	document.addEventListener("click", function(e) {
		if(!e.target.closest("#levels, #setLevel"))
			byId("levels").hidden = true;
	});

	if(Browser.capabilities.popupAsTab()) {
		// the popup is displayed as a normal tab
		// set 100% width/height
		for(const el of [document.documentElement, document.body, byId("container")]) {
			el.style.width = "100%";
			el.style.height = "100%";
		}
		// show the close button
		byId("close").style.display = "block";
		byId("close").addEventListener("click", Browser.gui.closePopup);

	} else {
		// normal popup, resize body to match #container
		const box = byId("container").getBoundingClientRect();

		for(const el of [document.documentElement, document.body]) {
			el.style.width = Math.ceil(box.width) + "px";
			el.style.height = Math.ceil(box.height) + "px";
		}
	}
}

(async function() {
	if(!Browser.testing) return;

	// test for nested calls, and for correct passing of tabId
	//
	Browser.rpc.register('nestedTestTab', function(tabId) {
		Browser.log("in nestedTestTab, returning 'popup'");
		return "popup";
	});

	Browser.log("calling nestedTestMain");
	const res = await Browser.rpc.call(null, 'nestedTestMain', []);
	Browser.log('got from nestedTestMain', res);
}());