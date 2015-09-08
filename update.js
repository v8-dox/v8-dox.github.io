'use strict';

var fs = require('fs');
var spawn = require('child_process').spawn;

var async = require('async');

var git = require('./git');

// sorts strings like v0.0.1 and v3.12.6
var versionSorter = function (a, b) {
    a = a.substr(1).split('.').map(Number);
    b = b.substr(1).split('.').map(Number);
    var i;
    for (i = 0; i < a.length; i += 1) {
        if (i >= b.length) {
            return 1;
        }
        if (a[i] !== b[i]) {
            return a[i] - b[i];
        }
    }
    return 0;
};

// a map of short hash to an array of versions that use that hash
var hash_version = {};

// a map of version to hash
var version_hash = {};

// valid version regex
var version_regex = /^v[0-9]+\.[0-9]+\.[0-9]+$/;

var ensureRemotes = function (callback) {
    return git.remotes(function (err, remotes) {
        if (err) {
            return callback(err);
        }
        return async.parallel({
            'nodejs-old': function (cb_parallel) {
                if (remotes.indexOf('nodejs-old') !== -1) {
                    return cb_parallel();
                }
                git.addRemote('nodejs-old', 'git@github.com:joyent/node.git', cb_parallel);
            },
            nodejs: function (cb_parallel) {
                if (remotes.indexOf('nodejs') !== -1) {
                    return cb_parallel();
                }
                git.addRemote('nodejs', 'git@github.com:nodejs/node.git', cb_parallel);
            },
            iojs: function (cb_parallel) {
                if (remotes.indexOf('iojs') !== -1) {
                    return cb_parallel();
                }
                git.addRemote('iojs', 'git@github.com:nodejs/io.js.git', cb_parallel);
            }
        }, callback);
    });
};

var updateGit = function (callback) {
    return async.series([
        function (cb_series) {
            return git.fetchWithTags('nodejs-old', cb_series);
        },
        function (cb_series) {
            return git.fetchWithTags('iojs', cb_series);
        },
        function (cb_series) {
            return git.fetchWithTags('nodejs', cb_series);
        }
    ], callback);
};

var nameForVersion = function (version) {
    if (version[0] !== 'v') {
        return 'unknown';
    }
    if (version[1] === '1' || version[1] === '2' || version[1] === '3') {
        return 'io.js';
    }
    return 'node.js';
};

var getVersionString = function (hash) {
    var versions = hash_version[hash].sort(versionSorter);
    var version_str = versions[0];
    if (versions.length > 1) {
        version_str += ' - ' + versions[versions.length - 1];
    }
    return version_str;
};

var writeDoxFile = function (hash, callback) {
    var versions = hash_version[hash].sort(versionSorter);
    var name = nameForVersion(versions[0]);
    var version_str = getVersionString(hash);
    var dox_contents = 'PROJECT_NAME = "V8 API Reference Guide for ' + name + ' ' + version_str + '"\n';
    dox_contents += 'OUTPUT_DIRECTORY = ./' + hash + '\n';
    dox_contents += 'INPUT = deps/v8/include\n';
    dox_contents += 'GENERATE_LATEX = NO\n';

    return fs.writeFile('dox', dox_contents, callback);
};

var rmrf = function (path, callback) {
    return fs.stat(path, function (err, stat) {
        if (err && err.code === 'ENOENT') {
            return callback();
        }
        if (err) {
            return callback(err);
        }
        if (stat.isDirectory()) {
            return fs.readdir(path, function (err, files) {
                if (err) {
                    return callback(err);
                }
                return async.each(files, function (file, cb_each) {
                    return rmrf(path + '/' + file, cb_each);
                }, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    return fs.rmdir(path, callback);
                });
            });
        }
        return fs.unlink(path, callback);
    });
};

var generateDox = function (hash, callback) {
    console.log('generating', hash, 'for', getVersionString(hash));
    return async.series([
        function (cb_series) {
            console.log('\twrite dox');
            return writeDoxFile(hash, cb_series);
        },
        function (cb_series) {
            console.log('\tremove any existing deps');
            return rmrf('deps', cb_series);
        },
        function (cb_series) {
            console.log('\tremove any existing directory');
            return rmrf(hash, cb_series);
        },
        function (cb_series) {
            console.log('\tcheckout deps');
            return git.checkoutPathByTreeish('deps/v8', hash, cb_series);
        },
        function (cb_series) {
            console.log('\tspawn doxygen');
            var doxygen = spawn('doxygen', ['dox'], {stdio: 'ignore'});
            doxygen.on('close', function (code) {
                if (code !== 0) {
                    return cb_series({name: 'BadExitCode', message: 'Doxygen exited with code ' + code});
                }
                return cb_series();
            });
        },
        function (cb_series) {
            console.log('\treset deps');
            return git.resetPath('deps', cb_series);
        },
        function (cb_series) {
            console.log('\tadd directory');
            return git.addPath(hash, cb_series);
        },
        function (cb_series) {
            console.log('\tremove dox');
            return rmrf('dox', cb_series);
        },
        function (cb_series) {
            console.log('\tremove deps');
            return rmrf('deps', cb_series);
        }
    ], callback);
};

var getLastThreeHashForVersionRegEx = function (regex) {
    var count = 0;
    var last_hash = '';
    return Object.keys(version_hash).filter(function (version) {
        return regex.test(version);
    }).sort(versionSorter).reverse().map(function (version) {
        return version_hash[version];
    }).filter(function (hash) {
        if (count >= 3) {
            return false;
        }
        if (hash === last_hash) {
            return false;
        }
        last_hash = hash;
        count += 1;
        return true;
    });
};

var node10_re = /^v0\.10\.[0-9]+$/;
var node12_re = /^v0\.12\.[0-9]+$/;
var iojs_re = /^v[1-3]+\.[0-9]+\.[0-9]+$/;
var node4_re = /^v[4-9]+\.[0-9]+\.[0-9]+$/;

var fillOutIndexTemplate = function (callback) {
    return async.parallel({
        LATEST_NODE10: function (cb_parallel) {
            var hashes = getLastThreeHashForVersionRegEx(node10_re);
            return setImmediate(cb_parallel, null, hashes.map(function (hash) {
                return '      <li><a href="' + hash + '/html/index.html">node.js ' + getVersionString(hash) + '</a></li>';
            }).join('\n'));
        },
        LATEST_NODE12: function (cb_parallel) {
            var hashes = getLastThreeHashForVersionRegEx(node12_re);
            return setImmediate(cb_parallel, null, hashes.map(function (hash) {
                return '      <li><a href="' + hash + '/html/index.html">node.js ' + getVersionString(hash) + '</a></li>';
            }).join('\n'));
        },
        LATEST_IOJS: function (cb_parallel) {
            var hashes = getLastThreeHashForVersionRegEx(iojs_re);
            return setImmediate(cb_parallel, null, hashes.map(function (hash) {
                return '      <li><a href="' + hash + '/html/index.html">io.js ' + getVersionString(hash) + '</a></li>';
            }).join('\n'));
        },
        LATEST_NODE4: function (cb_parallel) {
            var hashes = getLastThreeHashForVersionRegEx(node4_re);
            return setImmediate(cb_parallel, null, hashes.map(function (hash) {
                return '      <li><a href="' + hash + '/html/index.html">node.js ' + getVersionString(hash) + '</a></li>';
            }).join('\n'));
        },
        ALL_VERSION_OPTIONS: function (cb_parallel) {
            return setImmediate(cb_parallel, null, Object.keys(version_hash).sort(versionSorter).reverse().map(function (version) {
                var hash = version_hash[version];
                return '    <option value="' + hash + '">' + nameForVersion(version) + ' ' + version + '</option>';
            }).join('\n'));
        },
        GENERATE_TIME: function (cb_parallel) {
            return setImmediate(cb_parallel, null, new Date().toISOString());
        }
    }, function (err, replacements) {
        if (err) {
            return callback(err);
        }
        return fs.readFile('index.tmpl', 'utf8', function (err, template) {
            if (err) {
                return callback(err);
            }
            Object.keys(replacements).forEach(function (key) {
                template = template.replace('{' + key + '}', replacements[key]);
            });

            return fs.writeFile('index.html', template, function (err) {
                if (err) {
                    return callback(err);
                }
                return git.addPath('index.html', callback);
            });
        });
    });
};

var fillOutDataStructure = function (callback) {
    return git.tags(function (err, tags) {
        if (err) {
            return callback(err);
        }
        tags = tags.filter(function (tag) {
            return version_regex.test(tag);
        });

        return async.map(tags, function (tag, cb_map) {
            return git.lastHashForPathAndTag('deps/v8', tag, cb_map);
        }, function (err, hashes) {
            if (err) {
                return callback(err);
            }
            tags.forEach(function (tag, index) {
                var hash = hashes[index];
                version_hash[tag] = hash;
                if (hash_version[hash]) {
                    hash_version[hash].push(tag);
                } else {
                    hash_version[hash] = [tag];
                }
            });

            return callback();
        });
    });
};

var generateNeededDox = function (callback) {
    var last_node10 = getLastThreeHashForVersionRegEx(node10_re);
    var last_node12 = getLastThreeHashForVersionRegEx(node12_re);
    var last_iojs = getLastThreeHashForVersionRegEx(iojs_re);
    return async.filter(Object.keys(hash_version), function (hash, cb_filter) {
        if (hash === last_node10[0] || hash === last_node12[0] || hash === last_iojs[0]) {
            return setImmediate(cb_filter, true);
        }
        return fs.stat(hash, function (err, stat) {
            if (err) {
                return cb_filter(true);
            }
            return cb_filter(false);
        });
    }, function (needed) {
        return async.eachSeries(needed, function (hash, cb_each) {
            return async.waterfall([
                function (cb_waterfall) {
                    return fs.stat(hash, function (err, stat) {
                        if (err && err.code === 'ENOENT') {
                            return cb_waterfall();
                        }
                        return rmrf(hash, function (err) {
                            if (err) {
                                return cb_waterfall(err);
                            }
                            return cb_waterfall();
                        });
                    });
                },
                function (cb_waterfall) {
                    generateDox(hash, cb_waterfall);
                }
            ], cb_each);
        }, function (err) {
            if (err) {
                return callback(err);
            }
            return callback();
        });
    });
};

var commitAndPush = function (callback) {
    var commit_message = 'automated build ';
    commit_message += new Date().toISOString();
    return git.commit(commit_message, function (err) {
        if (err) {
            console.error('error committing:', err);
            return callback(err);
        }
        return git.push(callback);
    });
};

var update = function () {
    return async.series([
        ensureRemotes,
        updateGit,
        fillOutDataStructure,
        generateNeededDox,
        fillOutIndexTemplate,
        commitAndPush
    ], function (err) {
        if (err) {
            console.error('got an error:', err);
            process.exit(1);
        }
        process.exit(0);
    });
};

update();
