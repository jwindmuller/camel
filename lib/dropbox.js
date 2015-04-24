var express = require('express');
var router  = express.Router();
var util    = require('util');

var Posts = require('./posts');

var Dropbox = require("dropbox");
var client = new Dropbox.Client({
    key   : process.env.DROPBOX_KEY,
    secret: process.env.DROPBOX_SECRET
});
client.authDriver(
    new Dropbox.AuthDriver.NodeServer({ port: 5001 })
);

var DropboxDraftsFolder = 'Posts';

router.get('/', function(req, res) {
    if (RedirectIf.loggedIn('/db/o', res)) {
        return;
    }
    
    client.authenticate(function(error, client) {
      if (error) {
        return res.send(error);
      }
      res.redirect('/db/o');
    });
});


router.get('/o', function(req, res) {
    if (RedirectIf.loggedOut('/db/', res)) {
        return;
    }
    client.authenticate(function(error, client) {
        if (error) {
            return res.send(error);
        }
        listings  = {};
        recursions = 0;
        readDir([''], DropboxDraftsFolder, function() {
            var folderStructure = listings[''];
            res.send(
                '<ul>' +
                foldersAsLinks('Posts', folderStructure.Posts, true)
                + '</ul>'
            );
        });
    });
});

router.get('/f', function(req, res) {
    if (RedirectIf.loggedOut('/db/', res)) {
        return;
    }
    var path = req.query.f;
    if (path === undefined || validFiles.indexOf(path) === -1) {
        return res.redirect('/db/o');
    }
    client.authenticate(function(error, client) {
        if (error) {
            return res.send(error);
        }
        client.readFile(path, {buffer:true}, function(error, data, stat, rangeInfo) {
            var markdown = data.toString();
            Posts.sendMarkdownString(markdown, res);
        });
    });
});

module.exports = router;

var RedirectIf = {
    status: {
        loggedIn : true,
        loggedOut: false
    },
    loggedIn: function(redirect, res) {
        this._redirectIf(this.status.loggedIn, redirect, res);
    },
    loggedOut: function(redirect, res) {
        this._redirectIf(this.status.loggedOut, redirect, res);
    },
    _redirectIf: function(status, redirect, res) {
        if (client.isAuthenticated() === status) {
            res.redirect(redirect);
            return true;
        }
        return false;
    }
}

var listings = {};
var validFiles = [];
var recursions = 0;
function readDir(path, dir, callback) {
    recursions++;

    var content = listings;
    path.forEach(function(item) {
        var obj = content[item];
        if (obj === undefined) {
            content[item] = {};
        }
        content = content[item];
    });
    content[dir] = {};
    path.push(dir);

    client.readdir(path.join('/'), {}, function(error, files, draftsStat, fileStats) {
        if (error) {
            content[dir] = {'__error__': error };
            checkDone(callback);
            return;
        }
        fileStats.forEach(function(fileStat) {
            if (fileStat.isFolder) {
                readDir(path.clone(), fileStat.name, function() {
                    checkDone(callback);
                });
            } else {
                content[dir][fileStat.name] = fileStat.path;
            }
        });
        checkDone(callback);
    });
}

function checkDone(callback) {
    recursions--;
    if (recursions <= 0) {
        callback();
    }
}

function foldersAsLinks(folderName, structure) {
    var html = util.format('<li class="Folder">%s<ul>', folderName);
    Object.keys(structure, function(key, value) {
        var htmlForItem = '';
        if (typeof value === 'string') {
            htmlForItem = util.format('<li class="File"><a href="%s">%s (%s)</a></li>', 
                '/db/f?f=' + value,
                key , 
                value
            );
            if (value.endsWith(/\.(md|txt)/)) {
                validFiles.push(value);
            }
        } else {
            htmlForItem = foldersAsLinks(key, value, true);
        }
        html += htmlForItem;
    });
    html += '</ul></li>';
    return html;
}