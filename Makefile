
find = $(foreach dir,$(1),$(foreach d,$(wildcard $(dir)/*),$(call find,$(d),$(2))) $(wildcard $(dir)/$(strip $(2))))

FIREFOX ?= $(shell which firefox)
CHROME  ?= $(shell which google-chrome)
EDGE    ?= $(shell which microsoft-edge)
OPERA   ?= $(shell which opera)
VER      = $(shell sed -nE 's/.*"version": "([^"]+)".*/\1/p' src/manifest.json | head -1)


default:
	@echo "\nbuilding:"
	@echo make build-chrome
	@echo make build-firefox
	@echo "\npackaging:"
	@echo make package-chrome
	@echo make package-firefox
	@echo "\ntesting:"
	@echo make [CHROME=/path/to/google-chrome] test-chrome
	@echo make [FIREFOX=/path/to/firefox] test-firefox
	@echo make test-firefox-android
	@echo

clean:
	rm -rf build/


# build ##############################################################

build-chrome: build/chrome/manifest.json
build-opera: build/opera/manifest.json
build-firefox: build/firefox/manifest.json
build-edge: build/edge/manifest.json

COMMON_MODULES = -x ./src/js/common/browser_base.js -x ./src/js/common/browser.js -x ./src/js/common/util.js -x ./src/js/common/post-rpc.js -x ./src/js/common/laplace.js -x leaflet -x leaflet.locatecontrol -x intro.js -x jquery -x sglide

MV3_TARGETS = chrome edge opera
BUILD_NAME = $(notdir $(patsubst %/,%,$(dir $@)))
BUILD_DIR = $(patsubst %/,%,$(dir $@))
MV3_FLAG = $(if $(filter $(BUILD_NAME),$(MV3_TARGETS)),-Dis_chromium_mv3,)

build/%/manifest.json: $(call find, src, *) package.json package-lock.json Makefile
	rm -rf $(BUILD_DIR)
	mkdir -p $(BUILD_DIR)
	cp -r src/* $(BUILD_DIR)
	find $(BUILD_DIR)/js -type f -name '*.js' -delete

	# bundles with common modules
	npx browserify -r ./src/js/common/browser_base.js -r ./src/js/common/browser.js -r ./src/js/common/util.js -r ./src/js/common/post-rpc.js -r ./src/js/common/laplace.js  > $(BUILD_DIR)/js/common.js
	npx browserify -r leaflet -r leaflet.locatecontrol -r intro.js -r jquery -r sglide ./src/js/gui/load-jquery.js   > $(BUILD_DIR)/js/common-gui.js

	# jquery has no proper npm package, we just append the code (from jquery-mobile-babel-safe) into commin-gui.js. Seel also load-jquery.js.
	cat ./node_modules/jquery-mobile-babel-safe/js/jquery.mobile-1.4.5.js >> $(BUILD_DIR)/js/common-gui.js

	# entry points
	npx browserify $(COMMON_MODULES) ./src/js/main.js            > $(BUILD_DIR)/js/main.js
	npx browserify $(COMMON_MODULES) ./src/js/content/content.js > $(BUILD_DIR)/js/content/content.js
	npx browserify $(COMMON_MODULES) ./src/js/gui/options.js     > $(BUILD_DIR)/js/gui/options.js
	npx browserify $(COMMON_MODULES) ./src/js/gui/demo.js        > $(BUILD_DIR)/js/gui/demo.js
	npx browserify $(COMMON_MODULES) ./src/js/gui/popup.js       > $(BUILD_DIR)/js/gui/popup.js
	npx browserify $(COMMON_MODULES) ./src/js/gui/faq.js         > $(BUILD_DIR)/js/gui/faq.js

	npx browserify ./src/js/content/inject.js                    > $(BUILD_DIR)/js/content/inject.js
	if [ "$(filter $(BUILD_NAME), $(MV3_TARGETS))" ]; then npx browserify ./src/js/main.js > $(BUILD_DIR)/js/service-worker.js; fi

	# copy module css/images
	cp -r node_modules/jquery-mobile-babel-safe/css/images node_modules/jquery-mobile-babel-safe/css/jquery.mobile-1.4.5.min.css $(BUILD_DIR)/css/
	cp -r node_modules/leaflet/dist/images                 node_modules/leaflet/dist/leaflet.css                                 $(BUILD_DIR)/css/
	cp node_modules/intro.js/minified/introjs.min.css                                                                            $(BUILD_DIR)/css/

	cpp -P -Dis_$(BUILD_NAME) $(MV3_FLAG) src/manifest.json | sed '/^[[:space:]]*\/\//d' > $(BUILD_DIR)/manifest.json
	sed 's/%BUILD%/$(BUILD_NAME)/' $(BUILD_DIR)/js/common.js > $(BUILD_DIR)/js/common.js.tmp && mv $(BUILD_DIR)/js/common.js.tmp $(BUILD_DIR)/js/common.js
	if [ -f $(BUILD_DIR)/js/service-worker.js ]; then sed 's/%BUILD%/$(BUILD_NAME)/' $(BUILD_DIR)/js/service-worker.js > $(BUILD_DIR)/js/service-worker.js.tmp && mv $(BUILD_DIR)/js/service-worker.js.tmp $(BUILD_DIR)/js/service-worker.js; fi


# package #############################################################

package-chrome:  build/location-guard-chrome-$(VER).zip
package-opera:   build/location-guard-opera-$(VER).zip
package-firefox: build/location-guard-firefox-$(VER).zip
package-edge:    build/location-guard-edge-$(VER).zip

build/location-guard-%-$(VER).zip: build/%/manifest.json
	rm -f build/location-guard-$*-$(VER).zip
	(cd build/$* && zip -r ../location-guard-$*-$(VER).zip .)

build/location-guard-%-$(VER).xpi: build/location-guard-%-$(VER).zip
	cp $< $@


# test #################################################################

test-chrome: build/chrome/manifest.json
	@test -n "$(CHROME)" || (echo 'Set CHROME to a Chrome for Testing or Chromium executable (Chrome 137+ ignores --load-extension).' >&2; exit 2)
	node scripts/smoke-chrome.js "$(CHROME)" build/chrome

# Headed interactive launch for older Chromium builds that still accept --load-extension.
test-chrome-headed: build/chrome/manifest.json
	@test -n "$(CHROME)" || (echo 'Set CHROME to a Chromium executable.' >&2; exit 2)
	"$(CHROME)" --load-extension=build/chrome/ --user-data-dir=/private/tmp/location-guard-chrome-headed-profile --no-first-run --no-default-browser-check

test-opera: build/opera/manifest.json
	@rm -rf /tmp/lg-opera-profile
	"$(OPERA)" --load-extension=build/opera/ --user-data-dir=/tmp/lg-opera-profile --no-first-run --no-default-browser-check

test-firefox: build/firefox/manifest.json
	npx web-ext --source-dir build/firefox -f "$(FIREFOX)" run --browser-console

test-firefox-android: build/location-guard-firefox-$(VER).xpi
	adb push build/location-guard-firefox-$(VER).xpi /mnt/sdcard/
	adb shell am start -a android.intent.action.VIEW -n org.mozilla.firefox/.App -d 'file:///mnt/sdcard/location-guard-firefox-$(VER).xpi'

test-edge: build/edge/manifest.json
	@rm -rf /tmp/lg-edge-profile
	"$(EDGE)" --load-extension=build/edge/ --user-data-dir=/tmp/lg-edge-profile --no-first-run --no-default-browser-check
