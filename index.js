exports.isMonitoringModule = true;
exports.hasCron = true;
exports.snapshotData = true;

var exec = require('child_process').exec;

// Get right command for right platform
var getCommand = function(platform, command, serviceName){
	var serviceName = (serviceName ? serviceName : 'nothing');

	var commands = {
		darwin: {
			list: 'launchctl list',
			stop: 'launchctl stop ' + serviceName,
			start: 'launchctl start ' + serviceName,
			restart: 'launchctl stop ' + serviceName + ' && launchctl start ' + serviceName
		},
		linux: {
			list: 'service --status-all',
			stop: 'sudo service ' + serviceName + ' stop',
			start: 'sudo service ' + serviceName + ' start',
			restart: 'sudo service ' + serviceName + ' restart'
		},
		win32: {
			list: 'sc queryex type= service state= all',
			stop: 'net stop ' + serviceName,
			start: 'net start ' + serviceName,
			restart: 'net stop ' + serviceName + ' && net start ' + serviceName
		}
	};

	return commands[platform][command];
};

// Process mac/darwin services list to readable objects
var processDarwinServicesListResult = function(stdout) {  
	var lines = stdout.toString().split('\n');
	var headers = lines.splice(0, 1)[0].split('\t');

	var results = [];
	lines.forEach(function(line) {
		var parts = line.split('\t');

		if(parts.length > 2) {
			var result = {};
			// Add stdout parts to result object
			for(i = 0; i < headers.length; i++) {
				result[headers[i].toLowerCase()] = parts[i];
			}
			
			// Add state property
			if(result.pid != '-')
				result.state = "running";
			else
				result.state = "stopped";

			results.push(result);
		}
	});

	return results;
};

// Process linux services list to readable objects
var processLinuxServicesListResult = function(stdout) {
	var lines = stdout.toString().split('\n');

	var results = [];
	for(i = lines.length - 1; i >= 0; i--) {
		if(lines[i].indexOf('running') > -1 || lines[i].indexOf('stopped') > -1){
			// Define servicesList format
			var result = {
				pid: '-',
				state: '',
				label: ''
			};

			var parts = lines[i].split(' is ');

			// Filter if part exists string. Remove if necessary.
			if(parts[0].indexOf(' (pid  ') > -1)
				parts[0] = parts[0].split(' (pid  ');
			if(parts[0].indexOf(' (pid ') > -1) 
				parts[0] = parts[0].split(' (pid ');

			// Fill result object
			if(Array.isArray(parts[0])){
				result.pid = parts[0][1].slice(0, -1);
				result.label = parts[0][0];
			} else {
				result.label = parts[0];
			}
			result.state = parts[1];

			results.push(parts);
		}
	}

	return results;
};

// Process windows services list to readable objects
var processWindowsServicesListResult = function(stdout) {
	var lines = stdout.toString().split('\r\n\r\n');

	var results = [];
	for(i = 0; i < lines.length; i++){
		lines[i] = lines[i].split('\r\n');
		lines[i] = lines[i].filter(function(e){return e});
		
		for(j = lines[i].length - 1; j >= 0; j--){
			// Delete array items without valuable data
			if(lines[i][j].indexOf(":") == -1 || lines[i][j].indexOf("TYPE") > -1 || lines[i][j].indexOf("WIN32_EXIT_CODE") > -1 || lines[i][j].indexOf("SERVICE_EXIT_CODE") > -1 || lines[i][j].indexOf("CHECKPOINT") > -1 || lines[i][j].indexOf("WAIT_HINT") > -1 || lines[i][j].indexOf("FLAGS") > -1){
				lines[i].splice(j, 1);
			}
		}

		var result = {}
		for(j = lines[i].length - 1; j >= 0; j--){
			// Remove all spaces in front of words
			while(lines[i][j].charAt(0) == (" ")){ lines[i][j] = lines[i][j].substring(1); }

			// Split key and value
			if(lines[i][j].indexOf(': ') > -1)
				lines[i][j] = lines[i][j].split(': ');
			if(lines[i][j].indexOf(':') > -1) 
				lines[i][j] = lines[i][j].split(':');

			// Delete all spaces
			if(lines[i][j][0] != 'DISPLAY_NAME'){
				lines[i][j][0] = lines[i][j][0].replace(/^\s+|\s+$/g, '');
				lines[i][j][1] = lines[i][j][1].replace(/^\s+|\s+$/g, '');
			}
			// Convert all characters to lowercase (except SERVICE_NAME value)
			if(lines[i][j][0] != 'SERVICE_NAME'){
				// Delete all spaces
				lines[i][j][0] = lines[i][j][0].toLowerCase();
				lines[i][j][1] = lines[i][j][1].toLowerCase();
			} else 
				lines[i][j][0] = 'label';

			// Delete statusCode befor state
			if(lines[i][j][0] == 'state')
				lines[i][j][1] = lines[i][j][1].substring(3);

			if(lines[i][j][0] == 'pid' && lines[i][j][1] == '0')
				lines[i][j][1] = '-';

			// Modifications done - do last modification - convert to object property
			result[lines[i][j][0]] = lines[i][j][1];
		}
		results.push(result);
	}

	return results;
}

// listServices for specified platform
var listServices = function(platform, callback) {
	var command = getCommand(platform, 'list');

	exec(command, function(err, out, code) {
		if (err instanceof Error)
			callback(err);

		if(platform == "darwin")
			callback(null, processDarwinServicesListResult(out));
		else if (platform == "linux")
			callback(null, processLinuxServicesListResult(out));
		else if (platform == "win32")
			callback(null, processWindowsServicesListResult(out));
		else
			callback("monitor-service listServices: Other platform provided. What to do?");
	});
}


// Get serviceList data to executeCron
exports.executeCron = function (callback) {
	var platform = this.monitorClient.platform;

	listServices(platform, function(err, data){
		if(err)
			callback(err);
		else
			callback(null, data);
	});
}

// List all services for a specified platform
exports.list = function (data, callback) {
	var platform = this.monitorClient.platform;

	listServices(platform, function(err, list){
		if (err instanceof Error) {
			data.error = err;
			callback(data);
		} else {
			data.data = list;
			callback(data);
		}
	});
}

// Start a specified service for a specified platform
exports.start = function (data, callback) {
	var platform = this.monitorClient.platform;
	var command = getCommand(platform, 'start', data.params.serviceName);

	exec(command, function(err, out, code) {
		if (err instanceof Error) {
			data.error = err;
			callback(data);
		} else {
			data.data = out;
			callback(data);
		}
	});
}

// Stop a specified service for a specified platform
exports.stop = function (data, callback) {
	var platform = this.monitorClient.platform;
	var command = getCommand(platform, 'stop', data.params.serviceName);

	exec(command, function(err, out, code) {
		if (err instanceof Error) {
			data.error = err;
			callback(data);
		} else {
			data.data = out;
			callback(data);
		}
	});
}

// Restart a specified service for a specified platform
exports.restart = function (data, callback) {
	var platform = this.monitorClient.platform;
	var command = getCommand(platform, 'restart', data.params.serviceName);

	exec(command, function(err, out, code) {
		if (err instanceof Error) {
			data.error = err;
			callback(data);
		} else {
			data.data = out;
			callback(data);
		}
	});
}