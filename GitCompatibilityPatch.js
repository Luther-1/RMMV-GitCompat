//=============================================================================
// GitCompatibilityPatch.js
//=============================================================================

/*:
 * @plugindesc Automatically formats JSON files and manages the event table when the game is launched in playtest mode.
 * @author Marcus Der
 * 
 * @param Format All
 * @desc Format JSON outside of the data directory?
 * @type boolean
 * @on Yes
 * @off No
 * @default false
 * 
 * @param Debug
 * @desc Print debug messages?
 * @type boolean
 * @on Yes
 * @off No
 * @default false 
 * 
 * @param Remove RPG Maker Data
 * @desc Attempts to zero out data that is unique to each user.
 * @type boolean
 * @on Yes
 * @off No
 * @default true   
 * 
 * 
 * @param Manage Events
 * @desc Manages the event table to allow multiple users to work on events on the same map.
 * @type boolean
 * @on Yes
 * @off No
 * @default true   
 *
 * @help This plugin alters files on the hard drive every time the game is run.
 * Saving RPG maker will reset all the changes that this plugin makes,
 * so remember to always run a playtest right before closing RPG maker!
 */
(function() {
	if(!Utils.isOptionValid('test')) {
		return; // do nothing if it's not test
	}

	if(!Utils.isNwjs()) { // this should never happen, but just in case print a useful error.
		console.error("Platform is not Nwjs, GitCompatibilityPatch cannot run!");
		return;
	}

	const fs = require('fs');
	const path = require('path');

	const jsonIndentSpaces = 2;

	const blacklist = [".git"];

	var parameters = PluginManager.parameters("GitCompatibilityPatch");
    var formatAll = parameters["Format All"] === 'true';
    var debug = parameters["Debug"] === 'true';
    var removeRPG = parameters["Remove RPG Maker Data"] === 'true';
    var manageEvents = parameters["Manage Events"] === 'true';

	const systemReplacer = function(key, value) {
		if(key === "versionId") {
			return 0;
		}
		return value;
	}
	
	const mapReplacer = function(key, value) {
		return value;
	}

	const mapInfosReplacer = function(key, value) {
		if(key === "scrollX" || key === "scrollY") {
			return 0;
		}
		if(key === "expanded") {
			return false;
		}
		return value;
	}

	let isMap = function(filename) {
		return /[M|m]ap\d{3}\.json/.test(filename);
	}

	let getReplacerFor = function(filepath) {
		filename = path.basename(filepath).toLowerCase();

		if(filename === "system.json") {
			return systemReplacer;
		}
		if(isMap(filename)) {
			return mapReplacer;
		}
		if(filename === "mapinfos.json") {
			return mapInfosReplacer;
		}

		return null;
	}

	let preprocessMap = function(filepath, json) {
		filename = path.basename(filepath);
		if(!isMap(filename)) {
			return;
		}

		// the list to actually be written
		var newEventList = [];

		for(var i =0;i<json.width*json.height;i++) {
			newEventList.push(null)
		}

		// copy all of the temp events into a buffer
		var eventBuffer = [];
		for(var i =0;i<json.events.length;i++) {
			if(json.events[i]!==null) {
				eventBuffer.push(json.events[i]);
			}
		}

		for(const event of eventBuffer) {
			const idx = event.y * json.width + event.x
			newEventList[idx] = event;
			event.id = idx; 
		}

		for(var i =0;i<newEventList.length;i++) {
			newEventList[i] = JSON.stringify(newEventList[i])
		}

		newEventList.splice(0,0,null); // all RPG maker event lists start with null for some reason

		json.events = [];
		return newEventList
	}

	// quick and dirty indenting code
	var indentCache = []; // will never exeed 2
	var indent = "";
	for(var i =0;i<jsonIndentSpaces;i++) {
		indent+=" ";
	}
	for(var i =0;i<5;i++) {
		var str = "";
		for(var k =0;k<i;k++) {
			str+=indent
		}
		indentCache.push(str)
	}

	let getIndent = function(idx) {
		return indentCache[idx]
	}

	let insertMapEventData = function(formatted, events) {
		if(events === undefined) {
			return formatted;
		}

		// extremely hacky: we want events to be in a compressed format, but everything else to be in a normal format...
		// manually insert our events

		var components = formatted.split("\n");
		var idx = -1;
		for(var i =components.length-1;i>=0;i--) {
			if(components[i].contains("\"events\":")) { // please never write this string in your events haha
				idx = i;
				break;
			}
		}
		if(idx === -1) {
			throw "Illegal state.";
		}
		components.splice(idx,2) // remove the end of the formatted JSON. events are always at the end.

		// now we insert our JSON
		components.push(getIndent(1)+"\"events\": [");
		for(var i =0;i<events.length;i++) {
			//components.push(""); // helps git recognize sections
			components.push(getIndent(2) + events[i] + (i === events.length-1 ? "" : ","));
		}
		components.push(getIndent(1)+"]");
		components.push("}");

		return components.join("\n");
	}

	let formatJson = function(filepath) {
		var file = fs.readFileSync(filepath, {encoding:'utf8', flag:'r'});
		var json = JSON.parse(file);
		if(manageEvents) {
			var events = preprocessMap(filepath, json);
		}
		if(removeRPG) {
			replacer = getReplacerFor(filepath);
			var formatted = JSON.stringify(json, replacer, jsonIndentSpaces);
		} else {
			var formatted = JSON.stringify(json, null, jsonIndentSpaces);
		}
		if(manageEvents) {
			formatted = insertMapEventData(formatted, events);
		}
		
		

		if(formatted === file) {
			if(debug) {
				console.log("No changes in file \""+filepath+"\". Ignoring");
			}
			return 0;
		} else {
			if(debug) {
				console.log("Formatting \""+filepath+"\"");
			}
			fs.writeFileSync(filepath, formatted);
			return 1;
		}
		
	}

	let formatJsonRecurse = function(dir) {
		if(debug) {
			console.log("Scanning directory \""+dir+"\"...");
		}
		var files = fs.readdirSync(dir);
		var total = 0;

		for(const file of files) {
			let combined = path.join(dir,file)
			if(fs.statSync(combined).isDirectory() && blacklist.indexOf(file.toLowerCase()) === -1) {
				total += formatJsonRecurse(combined);
			} else {
				if(combined.toLowerCase().endsWith(".json")) {
					total += formatJson(combined);
				}
			}
		}
		
		return total;
	}

	let fmt = function() {
		var total = 0;
		var start = window.performance.now();
		if(formatAll) {
			total = formatJsonRecurse("./");
		} else {
			total = formatJsonRecurse("./data")
		}

		if(debug) {
			var time = window.performance.now()-start;
			console.log("Formatted "+total+" files in "+time+" ms");
		}
	}
	
	let oldFunc = Scene_Boot.prototype.create
	Scene_Boot.prototype.create = function() {
		var start = window.performance.now();
		fmt();
		if(debug) {
			var time = window.performance.now()-start;
			console.log("Total time taken: "+time+" ms");
		}
		oldFunc.call(this);
	}

})();

