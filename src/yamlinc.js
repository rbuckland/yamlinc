/*!
 * Yamlinc: v0.0.63
 * Copyright(c) 2016-2018 Javanile.org
 * MIT Licensed
 */

var fs = require("fs"),
    realpath = require("fs").realpathSync,
    dirname = require("path").dirname,
    basename = require("path").basename,
    join = require("path").join,
    merge = require("deepmerge"),
    yamljs = require("js-yaml"),
    helpers = require("./helpers"),
    values = require('object.values'),
    cuid = require('cuid'),
    EOL = require('os').EOL;

var chokidar = require("chokidar");

module.exports = {

    /**
     *
     */
    mute: false,

    /**
     *
     */
    watcherEnabled: false,

    /**
     *
     */
    spawnRunning: false,

    /**
     *
     */
    includeTag: '$include',

    /**
     *
     */
    escapeTag: '\\$include',

    /**
     *
     */
    extensions: ['yml', 'yaml'],

    /**
     *
     */
    extensionsRule: new RegExp('\\.(yml|yaml)$', 'i'),

    /**
     *
     */
    incExtensionsRule: new RegExp('\\.inc\\.(yml|yaml)$', 'i'),

    /**
     *
     */
    options: {
        '--mute': 'setMute'
    },

    /**
     *
     */
    commands: {
        '--help': 'getHelp',
        '--version': 'getVersion',
        '--watch': 'runCommandWatch',
        '--exec': 'runCommandExec'
    },

    /**
     * Command line entry-point.
     *
     * @param {array} args a list of arguments
     * @returns {string}
     */
    run: function (args, callback) {
        if (typeof args == "undefined" || !args || args.length === 0) {
            return helpers.error("Arguments error", "type: yamlinc --help", callback);
        }

        // handle command-line options
        for (var option in this.options) {
            if (args.indexOf(option) > -1) {
                this[this.options[option]](args);
            }
        }

        // handle command-line commands
        for (var command in this.commands) {
            if (args.indexOf(command) > -1) {
                return this[this.commands[command]](args, callback);
            }
        }

        // looking for file in arguments
        var file = this.getInputFile(args);
        if (!file) {
            return helpers.error("Arguments error", "missing file name.", callback);
        }

        // generate name of .inc.yml output file
        var incFile = this.getIncFile(file);

        // compile yaml files
        return this.compile(file, incFile, callback);
    },

    /**
     *
     * @param file
     * @returns {*}
     */
    resolve: function(file) {
        var yamlinc = this;
        var base = dirname(file);
        var code = fs.readFileSync(file).toString()
            .replace(this.getRegExpIncludeTag(), function (tag) {
                return tag.replace(yamlinc.includeTag, yamlinc.includeTag + '_' + cuid());
            });
        var data = yamljs.safeLoad(code);

        this.recursiveResolve(data, base);
        this.recursiveSanitize(data);

        return data;
    },

    /**
     * Walk through array and find include tag.
     *
     * @param array  $yaml       reference of an array
     * @param string $includeTag tag to include file
     */
    recursiveResolve: function(data, base) {
        if (typeof data !== 'object') { return; }

        var includes = {};
        for (var key in data) {
            if (this.isKeyMatchIncludeTag(key)) {
                if (typeof data[key] === "string" && data[key]) {
                    includes = this.recursiveInclude(base + '/' + data[key], includes);
                } else if (typeof data[key] === "object") {
                    for (var index in data[key]) {
                        includes = this.recursiveInclude(base + '/' + data[key][index], includes);
                    }
                }
                delete data[key];
                continue;
            }
            this.recursiveResolve(data[key], base);
        }

        if (helpers.isNotEmptyObject(includes)) {
            data = Object.assign(data, merge(data, includes));
        } else if (helpers.isNotEmptyArray(includes)) {
            data = Object.assign(data, merge(data, includes));
        }

        return data;
    },

    /**
     *
     * @param file
     * @param includes
     * @returns {*}
     */
    recursiveInclude: function (file, includes) {
        if (helpers.fileExists(file)) {
            helpers.info("Include", file);
            var include = this.resolve(file);
            if (helpers.isNotEmptyObject(include)) {
                includes = Object.assign(includes, merge(includes, include));
            } else if (helpers.isNotEmptyArray(include)) {
                includes = Object.assign(includes, merge(includes, include));
            }
        }
        return includes;
    },

    /**
     *
     */
    runCommandWatch: function (args, callback) {
        var yamlinc = this;
        args.splice(args.indexOf('--watch'), 1);

        var input = this.getInputFiles(args);
        if (!input) {
            return helpers.error('File error', 'missing input file to watch.', callback);
        }

        var match = [];
        for (var i in this.extensions) {
            match.push('./**/*.*');
        }

        var watcher = chokidar.watch(match, {
            persistent: true,
            usePolling: true
        });

        this.compile(input.file, input.incFile, callback);

        var cmd = args.shift();

        watcher
            .on('change', function(change) { yamlinc.handleFileChange(change, input, cmd, args); })
            .on('unlink', function(change) { yamlinc.handleFileChange(change, input, cmd, args); });

        setTimeout(function() {
            watcher.on('add', function(change) {
                yamlinc.handleFileChange(change, input, cmd, args);
            });
        }, 15000);

        setTimeout(function(){
            yamlinc.watcherEnabled = true;
            yamlinc.spawnLoop(cmd, args);
        }, 1000);
    },

    /**
     *
     */
    runCommandExec: function (args, callback) {
        var yamlinc = this;
        args.splice(args.indexOf('--exec'), 1);

        var input = this.getInputFiles(args);
        if (!input) {
            return helpers.error('File error', 'missing input file to exec.', callback);
        }

        this.compile(input.file, input.incFile, callback);

        var cmd = args.shift();

        helpers.info('Command', cmd + ' ' + args.join(' '));
        helpers.spawn(cmd, args);
    },

    /**
     *
     */
    spawnLoop: function (cmd, args) {
        if (this.spawnRunning) { return; }

        var yamlinc = this;
        this.spawnRunning = true;
        helpers.info('Command', cmd + ' ' + args.join(' '));
        helpers.spawn(cmd, args, function(){
            yamlinc.spawnRunning = false;
        });
    },

    /**
     *
     */
    handleFileChange: function (change, input, cmd, args) {
        if (this.skipFileChange(change)) { return; }
        helpers.info('Changed', change);
        this.compile(input.file, input.incFile);
        if (!this.spawnRunning) {
            this.spawnLoop(cmd, args);
        }
    },

    /**
     *
     */
    skipFileChange: function (change) {
        return !this.watcherEnabled
            || change.match(this.incExtensionsRule)
            || !change.match(this.extensionsRule);
    },

    /**
     * Compile Yaml file
     */
    compile: function (file, incFile, callback) {
        if (!helpers.fileExists(file)) {
            return helpers.error('File error', "file '" + file + "' not found.", callback);
        }

        // Compile and prepare disclaimer
        helpers.info("Analize", file);
        var data = this.resolve(file);
        var disclaimer = [
            "## --------------------",
            "## DON'T EDIT THIS FILE",
            "## --------------------",
            "## Engine: " + this.getVersion(),
            "## Source: " + file,
        ];

        // Print-out compiled code into file
        helpers.info("Compile", incFile);
        var code = data ? yamljs.safeDump(data) : 'empty: true' + EOL;
        fs.writeFileSync(incFile, disclaimer.join(EOL) + EOL + EOL + code);

        // Trigger debugger callback
        return helpers.isFunction(callback)
            && callback({ file: file, incFile: incFile });
    },

    /**
     *
     */
    recursiveSanitize: function(data) {
        if (helpers.isNotEmptyObject(data)) {
            for (var key in data) {
                if (helpers.isObjectizedArray(data[key])) {
                    data[key] = values(data[key]);
                    continue;
                }
                data[key] = this.recursiveSanitize(data[key]);
            }
        }
        return data;
    },

    /**
     *
     */
    getRegExpIncludeTag: function () {
        return new RegExp('^[ \\t]*' + this.escapeTag + '[ \\t]*:', 'gmi');
    },

    /**
     *
     * @param key
     * @param includeTag
     * @returns {Array|{index: number, input: string}|*}
     */
    isKeyMatchIncludeTag: function (key) {
        return key.match(new RegExp('^' + this.escapeTag + '_[a-z0-9]{25}$'));
    },

    /**
     * Get input file to parse inside command-line arguments.
     *
     * @param args
     * @returns {*}
     */
    getInputFile: function (args) {
        for (var i in args) {
            if (this.isArgumentInputFile(args, i)) {
                var file = args[i];
                args.splice(i, 1);
                return file;
            }
        }
    },

    /**
     *
     * @param args
     * @param i
     * @returns {boolean}
     */
    isArgumentInputFile: function (args, i) {
        return args.hasOwnProperty(i)
            && args[i].charAt(0) != '-'
            && args[i].match(this.extensionsRule);
    },

    /**
     *
     * @param args
     * @returns {{file: *, incFile: *}}
     */
    getInputFiles: function (args) {
        for (var i in args) {
            if (this.isArgumentInputFile(args, i)) {
                var file = args[i];
                args[i] = this.getIncFile(file);
                return { file: file, incFile: args[i] };
            }
        }
    },

    /**
     * Get .inc.yml file base on input.
     *
     * @param file
     * @returns {void|string}
     */
    getIncFile: function (file) {
        for (var i in this.extensions) {
            if (this.extensions.hasOwnProperty(i)) {
                var rule = new RegExp('\\.(' + this.extensions[i] + ')$', 'i');
                if (file.match(rule)) { return basename(file).replace(rule, '.inc.$1'); }
            }
        }
    },

    /**
     * Set mute mode.
     *
     * @param args
     */
    setMute: function (args) {
        args.splice(args.indexOf('--mute'), 1);
        helpers.mute = true;
        this.mute = true;
    },

    /**
     * Get sotware help.
     *
     * @param args
     */
    getHelp: function (args) {
        var help = join(__dirname, "../help/help.txt");
        return console.log(fs.readFileSync(help)+"");
    },

    /**
     * Get software version.
     *
     * @param args
     */
    getVersion: function () {
        var info = JSON.parse(fs.readFileSync(join(__dirname, "../package.json")), "utf8");
        return info.name + "@" + info.version;
    }
};
