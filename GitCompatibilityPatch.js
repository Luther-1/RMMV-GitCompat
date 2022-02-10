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
 * @param Max Users
 * @desc The maximum amount of users that will be using the this plugin. This value can be updated later.
 * @default 3  
 *
 * @help Each user must provide a unique ID number to identify them.
 * You will be prompted on first launch to input one.
 * Make sure no one in the team has the same ID.
 * 
 * This plugin relies on a gitignore to be set up to
 * exclude the .mvgitcompat file from the root directory.
 * If the git repository is in the project's root directory,
 * the plugin will automatically set this part up.
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

	const gitignorePath = "./.gitignore"
	const gitpath = "./.git"
	const identifierFilename = ".mvgitcompat"
	const identifierPath = "./" + identifierFilename
	const sharedDataFilename = ".mvgitcompatdata"
	const sharedDataPath = "./" + sharedDataFilename

	const eventBufferSize = 100; // this is the max amount of events you can add to RPG maker before you have to restart
	const warningThreshold = 0.9;

	const jsonIndentSpaces = 2;

	const blacklist = [".git"];

	var parameters = PluginManager.parameters("GitCompatibilityPatch");
    var formatAll = parameters["Format All"] === 'true';
    var debug = parameters["Debug"] === 'true';
    var removeRPG = parameters["Remove RPG Maker Data"] === 'true';
    var manageEvents = parameters["Manage Events"] === 'true';
	var maxUsers = Number(parameters["Max Users"]);
	var _maxUsers = -1;

	var userId = -1;

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

	let rewriteEventTable = function(events, oldMax, newMax) {
		var userIndex = userId-1;
		if(oldMax > newMax) {
			// map all existing events into an array
			eventMap = []
			for(var i=0;i<newMax;i++) {
				eventMap.push([]);
			}
			for(var i=eventBufferSize + 1;i<events.length;i+=oldMax) {
				for(var k=0;k<oldMax;k++) {
					if(k<newMax) {
						eventMap[k].push(events[i+k]);
					} else {
						if(events[i+k] !== null) {
							eventMap[userIndex].push(events[i+k]);
						}
					}
				}
			}

			// remove all events from old event list
			events.splice(eventBufferSize + 1,events.length - eventBufferSize - 1);

			// add the events from the array back to the main event list
			var largest = 0;
			for(var i =0;i<newMax;i++) {
				largest = Math.max(largest, eventMap[i].length);
			}

			for(var i =0;i<largest;i++) {
				for(var k=0;k<newMax;k++) {
					events.push(i < eventMap[k].length ? eventMap[k][i] : null);
				}
			}
		} else {
			var diff = newMax-oldMax;
			for(var i = eventBufferSize + 1 + oldMax;i<= events.length;i+=oldMax + diff) {
				for(var k=0;k<diff;k++) {
					events.splice(i,0,null);
				}
			}
		}
		
	}

	let preprocessMap = function(filepath, json) {
		filename = path.basename(filepath);
		if(!isMap(filename)) {
			return;
		}

		// the list to actually be written
		var newEventList = [];

		for(var i =0;i<eventBufferSize;i++) {
			newEventList.push(null);
		}

		// copy all of the temp events into a buffer
		var eventBuffer = [];
		for(var i =0;i<eventBufferSize && i<json.events.length;i++) {
			if(json.events[i]!==null) {
				eventBuffer.push(json.events[i]);
			}
		}

		// copy remaining events as usual
		for(var i = eventBufferSize + 1;i<json.events.length;i++) { // +1 to account for the RPG maker implicit null
			newEventList.push(json.events[i]);
		}

		if(eventBuffer.length !== 0 && eventBuffer[eventBuffer.length -1].id >= eventBufferSize * warningThreshold) {
			alert("Approaching max buffer size! ("+Math.round(eventBuffer[eventBuffer.length -1].id / eventBufferSize * 100)+"% full)"
			+ "\nPlease restart RPG maker to allow the formatter to commit changes.")
		}

		if(_maxUsers !== maxUsers) {
			rewriteEventTable(newEventList, _maxUsers, maxUsers);
		}

		// find our first index.
		var idx = eventBufferSize+userId;
		var count = 0;
		while(newEventList[idx + count * maxUsers] !== undefined && newEventList[idx + count * maxUsers] !== null) { //exceeds max events or it's empty
			count+=1;
		}

		idx += count * maxUsers;
		for(var i =0;i<eventBuffer.length;i++) {
			// extend array if necessary
			if(idx >= newEventList.length) {
				for(var k=0;k<maxUsers;k++) {
					newEventList.push(null);
				}
			}
			newEventList[idx] = eventBuffer[i];
			idx+=maxUsers;
		}

		newEventList.splice(0,0,null); // all RPG maker event lists start with null for some reason

		// remap event ids and stringify
		for(var i =0;i<newEventList.length;i++) {
			if(newEventList[i]!==null) {
				newEventList[i].id = i;
			}
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
			components.push(""); // helps git recognize sections
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

	let makeIdentifier = function() {

		var num = NaN;
		while(isNaN(num) || num === 0) { // 0 for cancelled
			num = Number(prompt("Please enter a unique ID in the range [1, "+String(maxUsers)+"]"));
		}

		var contents = String(num);

		fs.writeFileSync(identifierPath, contents);
	}

	let checkUserId = function() {
		if(!fs.existsSync(identifierPath)) {
			makeIdentifier();
		}

		userId = Number(fs.readFileSync(identifierPath, {encoding:'utf8', flag:'r'}));
	}

	let makeSharedData = function() {
		var contents = String(maxUsers);

		fs.writeFileSync(sharedDataPath, contents);
	}

	let checkSharedData = function() {
		if(!manageEvents) {
			return
		}
		if(!fs.existsSync(sharedDataPath)) {
			makeSharedData();
		}

		_maxUsers = Number(fs.readFileSync(sharedDataFilename, {encoding:'utf8', flag:'r'}));
	}

	let makeGitignore = function() {
		fs.writeFileSync(gitignorePath, identifierFilename)
	}

	let checkGitignore = function() {

		// first, check if we're even in a git repo.
		if(!fs.existsSync(gitpath)) {
			return;
		}

		// check if a .gitignore file exists.
		if(!fs.existsSync(gitignorePath)) {
			makeGitignore();
			return;
		}
		var gitignore = fs.readFileSync(gitignorePath, {encoding:'utf8', flag:'r'});

		if(gitignore.indexOf(identifierFilename) === -1) {
			gitignore+="\n"+identifierFilename;
			fs.writeFileSync(gitignorePath, gitignore);
		}
	}

	let checkIsChange = function() {
		if(!manageEvents) {
			return
		}
		if(_maxUsers > maxUsers) {
			if(userId > maxUsers) {
				alert("You cannot perform this operation. Reducing user count would delete events you own.");
				window.close();
				throw "Close";
			}
			if(!confirm("Decreasing max users will reassign all removed events to your user. \nAre you sure you want to continue?")) {
				window.close();
				throw "Close";
			}
			
		}
		if(_maxUsers !== maxUsers) {
			if(!confirm("WARNING: You are attempting to change the max users ("+String(_maxUsers)+"->"+String(maxUsers)+")."
			+"\n\nThis operation will completely re-write the event table which can cause merge conflicts or other errors."
			+"\n\nIt is highly recommended to git commit right before doing this.\nAre you sure you want to continue?")) {
				window.close()
				throw "Close";
			}
		}
	}

	let writeUserId = function() {
		var contents = String(userId)
		fs.writeFileSync(identifierPath, contents)
	}

	let writeSharedData = function() {
		if(!manageEvents) {
			return
		}
		var contents = String(maxUsers)
		fs.writeFileSync(sharedDataPath, contents)
	}
	
	let oldFunc = Scene_Boot.prototype.create
	Scene_Boot.prototype.create = function() {
		var start = window.performance.now();
		checkUserId();
		checkSharedData();
		checkGitignore();
		checkIsChange();
		fmt();
		writeUserId();
		writeSharedData();
		if(debug) {
			var time = window.performance.now()-start;
			console.log("Total time taken: "+time+" ms");
		}
		oldFunc.call(this);
	}

})();

