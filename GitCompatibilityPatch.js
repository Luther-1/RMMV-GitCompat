//=============================================================================
// GitCompatibilityPatch.js
//=============================================================================

/*:
 * @plugindesc Formats RPG maker files when the game is run in playtest mode to allow them to be auto merged in most cases.
 * @author Marcus Der
 * 
 * @param Format All
 * @desc Formats JSON outside of the data directory.
 * @type boolean
 * @on Yes
 * @off No
 * @default false
 * 
 * @param Debug
 * @desc Prints debug messages.
 * @type boolean
 * @on Yes
 * @off No
 * @default false 
 * 
 * @param Remove RPG Maker Data
 * @desc Attempts to zero out data such as camera location and map id that is unique to each user.
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 * 
 * @param Expand Map Groups
 * @desc Whether or not to default map groups to expanded or collapsed. Does nothing if Remove RPG Maker Data is false.
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 * 
 * @param Manage Events
 * @desc Manages the event table to allow multiple users to work on events on the same map.
 * @type boolean
 * @on Yes
 * @off No
 * @default true 
 * 
 * @param Disable Indentation
 * @desc Disables indentation on JSON files to save space.
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 * 
 * @param Blacklist
 * @desc File names that the plugin should not process (case insensitive).
 * @type text[]
 * @default ["commonevents.json","plugins.js"]
 *
 * @help READ THIS FULLY. This plugin is essentially a hack and has some caveats.
 * 
 * This plugin alters files on the hard drive every time the game is run.
 * It does NOT extend the editor's functionality, as a result
 * saving RPG maker will reset all the changes that this plugin makes.
 * Always run a playtest right before closing RPG maker to keep the changes!
 * 
 * As long as changes made by people (tiles, events) are mostly local to one
 * area of the map, git should be able to merge automatically in most cases.
 * 
 * Gitkraken's diff tool by default is unable to correctly diff the JSONS.
 * In the event of a merge conflcit. Use a tool such as VSCode 
 * (just open the file during a conflict) to do the diff.
 * 
 * Be aware that event id numbers are changed by this plugin when
 * Manage Events is enabled.
 * 
 * It is recommended to add the following files to your gitignore:
 *     save/*
 * 
 * Creating maps will always cause a merge conflict when two people
 * make a map as RPG maker will automatically assign the same
 * internal index to the maps. The plugin gets around this using
 * map identifiers. Append "::<unique_numerical_inex>" to your map name to
 * make the plugin change your map's internal index. Ex: To assign MyMap to
 * index 100, change the name from "MyMap" to "MyMap::100" The index must
 * be in the range 1 - 999. After applying the change, restart RPG maker.
 * 
 * 
 * This plugin is not a silver bullet solution to git with RPG maker.
 * Things like adding plugins, adjusting the database, and adding maps
 * may still cause merge conflicts and errors. This plugin only serves 
 * to mitigate common merge conflicts and make development easier.
 * 
 */
(function() {

	var parameters = PluginManager.parameters("GitCompatibilityPatch");
    var formatAll = parameters["Format All"] === 'true';
    var debug = parameters["Debug"] === 'true';
    var removeRPG = parameters["Remove RPG Maker Data"] === 'true';
    var expandMapGroups = parameters["Expand Map Groups"] === 'true';
    var manageEvents = parameters["Manage Events"] === 'true';
	var disableIndentation = parameters["Disable Indentation"] === 'true';
	try {
		var userBlacklist = JSON.parse(parameters["Blacklist"])
	} catch(e) {
		console.error("User blacklist malformed. ("+e+")");
		var userBlacklist = [];
	}

	var globalQuit = false;

	if(!Utils.isOptionValid('test')) {
		if(debug) {
			console.log("Test mode is inactive. GitCompatabilityPatch will not run.")
		}
		return; // do nothing if it's not test
	}

	if(!Utils.isNwjs()) { // this should never happen, but just in case print a useful error.
		console.error("Platform is not Nwjs, GitCompatibilityPatch cannot run!");
		return;
	}

	const fs = require('fs');
	const path = require('path');

	const jsonIndentSpaces = disableIndentation ? 0 : 2;

	const blacklist = [".git","mapinfos.json"];

	for(const item of userBlacklist) {
		blacklist.push(item.toLowerCase());
	}

	const systemReplacer = function(key, value) {
		if(key === "versionId") {
			return 0;
		}
		if(key === "editMapId") {
			return 1;
		}
		return value;
	}
	
	const mapReplacer = function(key, value) {
		return value;
	}

	// unused since it's blacklisted
	const mapInfosReplacer = function(key, value) {
		if(key === "scrollX" || key === "scrollY") {
			return 0;
		}
		if(key === "expanded") {
			return expandMapGroups;
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

		for(var i =0;i<json.width*json.height + 1;i++) { // RPG maker has an implicit null at the start of the events list.
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
			const idx = event.y * json.width + event.x + 1
			newEventList[idx] = event;
			event.id = idx; 
		}

		for(var i =0;i<newEventList.length;i++) {
			newEventList[i] = JSON.stringify(newEventList[i])
		}

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
			if(blacklist.includes(file.toLowerCase())) {
				console.log("Skipping blacklisted file \""+file+"\"");
				continue;
			}
			let combined = path.join(dir,file)
			if(fs.statSync(combined).isDirectory()) {
				total += formatJsonRecurse(combined);
			} else {
				if(combined.toLowerCase().endsWith(".json")) {
					total += formatJson(combined);
				}
			}
		}
		
		return total;
	}

	let extractMappings = function(mapinfo) {
		var mappings = [];
		const maxMaps = 999;

		for(const map of mapinfo) {
			if(map === null) {
				continue;
			}

			var match = /(::(\d+))$/.exec(map.name);
			if(match == null) {
				continue;
			}
			var number = Number(match[2])

			if(isNaN(number) || number < 1 || number > maxMaps) {
				console.error("Map "+map.name+" has invalid index of "+String(number)+" (parsed: "+match[2]+")");
				continue;
			}

			mappings.push({map:map,fromIndex:map.id,toIndex:number});
		}

		return mappings;
	}

	let fixMapReferences = function(mappings) {
		var mappingArray = [];
		for(var i =0;i<1000;i++) {
			mappingArray.push(i);
		}
		for(const mapping of mappings) {
			mappingArray[mapping.fromIndex] = mappingArray.toIndex;
		}

		// now load all the maps and try to fixup anything that references a map
		const baseDir = "./data"
		var files = fs.readdirSync(baseDir);
		for(const file of files) {
			if(!isMap(file)) {
				continue;
			}

			const fullpath = path.join(baseDir,file);

			if(debug) {
				console.log("Fixing transfers for "+file);
			}

			var map = JSON.parse(fs.readFileSync(fullpath, {encoding:'utf8', flag:'r'}))
			var events = map.events;
			for(const event of events) {
				if(event === null) {
					continue;
				}
				for(const page of event.pages) {
					for(const item of page.list) {
						// map transfer
						if(item.code === 201) {
							item.parameters[1] = mappingArray[item.parameters[1]];
						}
					}
				}
			}

			fs.writeFileSync(fullpath, JSON.stringify(map, null, 2));
		}
	}

	let rewriteMapFiles = function(mapinfo, mappings) {
		const updateMapIndex = function(array, from, to) {
			array[to] = newData[from];
			array[from] = null;
			array[to].id = to;
		}

		var newData = [];
		for(var i =0;i<1000;i++) {
			newData.push(null);
		}

		for(const map of mapinfo) {
			if(map !== null) {
				newData[map.id] = map;
			}
		}

		var changed = false;
		var error = "";

		for(const mapping of mappings) {
			if(mapping.fromIndex === mapping.toIndex) {
				continue;
			}

			var srcFile = "./data/Map"+String(mapping.fromIndex).padStart(3,'0')+".json";
			var dstFile = "./data/Map"+String(mapping.toIndex).padStart(3,'0')+".json";

			if(newData[mapping.toIndex] !== null) {
				var error = "Cannot remap \""+newData[mapping.fromIndex].name 
				+ "\" ("+String(mapping.fromIndex)+"->"+String(mapping.toIndex)+"). Already occupied by \""+newData[mapping.toIndex].name+"\"";
				continue;
			}

			if(!fs.existsSync(srcFile)) {
				if(debug) {
					console.log("No Changes in file \""+srcFile+"\". Ignoring");
				}
				changed = true;
				updateMapIndex(newData,mapping.fromIndex,mapping.toIndex)
				continue;
			}

			if(debug) {
				console.log("Remapping map \""+srcFile.substring(srcFile.lastIndexOf("/"))+"\" to \""+dstFile.substring(dstFile.lastIndexOf("/"))+"\"");
			}
			
			if(fs.existsSync(dstFile)) {
				fs.unlinkSync(dstFile);
			}
			fs.renameSync(srcFile,dstFile);

			changed = true;
			updateMapIndex(newData,mapping.fromIndex,mapping.toIndex)
		}

		if(error.length !== 0) {
			alert(error);
			globalQuit=true;
		}
		else if(changed) {
			fixMapReferences(mappings);
			alert("Map files have changed on disk. Please reload the project for the changes to take effect.")
			globalQuit = true;
		}
		return newData;
	}

	let formatMapinfoEntries = function(mapinfo) {
		if(!removeRPG) {
			return;
		}
		for(const map of mapinfo) {
			if(map === null) {
				continue;
			}
			map.scrollX = 0;
			map.scrollY = 0;
			map.expanded = expandMapGroups;
		}
	}

	let formatMaps = function() {
		const mapInfosPath = "./data/MapInfos.json";
		var mapinfo = JSON.parse(fs.readFileSync(mapInfosPath, {encoding:'utf8', flag:'r'}))
		formatMapinfoEntries(mapinfo);
		var mappings = extractMappings(mapinfo)
		
		var newData = rewriteMapFiles(mapinfo, mappings);

		var fileContents = ["["];
		for(var i =0;i<newData.length;i++) {
			var contents = getIndent(1) + JSON.stringify(newData[i]) + (i === newData.length-1 ? "" : ",");
			fileContents.push(contents);
		}
		fileContents.push("]");

		var mapJSON = fileContents.join("\n");
		fs.writeFileSync(mapInfosPath,mapJSON)
	}

	let fmt = function() {
		globalMapsData = {};
		var total = 0;
		var start = window.performance.now();

		formatMaps();

		if(formatAll) {
			total = formatJsonRecurse("./");
		} else {
			total = formatJsonRecurse("./data")
		}

		if(debug) {
			var time = window.performance.now()-start;
			console.log("Updated "+total+" files in "+time+" ms");
		}

		if(globalQuit) {
			window.close();
			throw "GitCompatabilityPatch close";
		}
	}
	
	let oldFunc = Scene_Boot.prototype.create
	Scene_Boot.prototype.create = function() {
		fmt();
		oldFunc.call(this);
	}

})();

