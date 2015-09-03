'use strict';

var spawn = require('child_process').spawn;

var byline = require('byline');

var command = function (command, args, callback) {
    if (callback === undefined) {
        callback = args;
        args = [];
    }
    args.unshift(command);
    var git = spawn('git', args);
    var remotes = [];
    var stdout = byline.createStream(git.stdout);
    stdout.on('data', function (line) {
        remotes.push(line.toString('utf8'));
    });
    git.on('close', function (code) {
        if (code !== 0) {
            return callback({name: 'BadCode', message: command + ' got exit code ' + code});
        }
        return callback(null, remotes);
    });
};

exports.remotes = function (callback) {
    return command('remote', callback);
};

exports.addRemote = function (name, location, callback) {
    return command('remote', ['add', name, location], callback);
};

exports.tags = function (callback) {
    return command('tag', callback);
};

exports.fetchWithTags = function (name, callback) {
    return command('fetch', ['--tags', name], callback);
};

exports.lastHashForPathAndTag = function (path, tag, callback) {
    return command('log', ['--pretty=format:%h', 'refs/tags/' + tag, '--', path], function (err, hashes) {
        if (err) {
            return callback(err);
        }
        if (hashes.length === 0) {
            return callback({name: 'ENOENT', message: 'path or tag is wrong'});
        }
        return callback(null, hashes[0]);
    });
};

exports.checkoutPathByTreeish = function (path, treeish, callback) {
    return command('checkout', [treeish, '--', path], function (err) {
        return callback(err);
    });
};

exports.addPath = function (path, callback) {
    return command('add', ['--', path], callback);
};

exports.resetPath = function (path, callback) {
    return command('reset', ['--', path], callback);
};

exports.commit = function (message, callback) {
    return command('commit', ['-m', message], callback);
};

exports.push = function (callback) {
    return command('push', ['-n'], callback);
};
