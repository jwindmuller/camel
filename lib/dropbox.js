var express = require('express');
var router  = express.Router();
var util    = require('util');
var fs      = require('fs');
var crypto  = require('crypto');

var Handlebars = require('handlebars');

var Posts = require('./posts');
var CamelAccess = '';
var Dropbox = require("dropbox");
var client = new Dropbox.Client({
    key   : process.env.DROPBOX_KEY,
    secret: process.env.DROPBOX_SECRET
});
client.authDriver(
    new Dropbox.AuthDriver.NodeServer({ port: 5001 })
);

var DropboxDraftsFolder = 'Posts';
function doWithDropboxAccess(req, res, callback, checkBrowserToken) {
    if (checkBrowserToken !== false) {
        if (req.cookies.CamelAccess !== CamelAccess) {
            return res.redirect('/');
        }
    }
    client.authenticate(function(error, client) {
        if (error) {
            return res.send(error);
        }
        client.getAccountInfo({}, function(error, info) {
            if (error) {
                return res.send(error);
            }
            if (info.email !== process.env.DROPBOX_EMAIL) {
                return res.redirect('/db/q');
            }
            callback(req, res);
        });
    });
}
router.get('/', function(req, res) {
    if (RedirectIf.loggedIn('/db/o', res)) {
        return;
    }
    doWithDropboxAccess(req, res, function(req, res) {
        CamelAccess = crypto.randomBytes(10).toString('hex');
        res.cookie('CamelAccess', CamelAccess, { maxAge: 900000, httpOnly: true });
        res.redirect('/db/o');  
    }, false);
});

router.get('/o', function(req, res) {
    if (RedirectIf.loggedOut('/db/', req, res)) {
        return;
    }
    doWithDropboxAccess(req, res, function(req, res) {
        listings  = {};
        recursions = 0;
        readDir([''], DropboxDraftsFolder, function() {
            var folderStructure = listings[''];
            var html = fs.readFileSync(__dirname + '/../templates/drafts.html', {encoding: 'utf8'});
            var content = util.format(
                '<ul class="list-group">%s</ul>',
                foldersAsLinks('Posts', folderStructure.Posts, true)
            );
            var template = Handlebars.compile(html, {noEscape: true});
            var html = template({content:content, Title: 'Dropbox drafts folder'});
            res.send(html);
        });
    });
});

router.get('/f', function(req, res) {
    if (RedirectIf.loggedOut('/db/', req, res)) {
        return;
    }
    var path = req.query.f;
    if (validFiles.indexOf(path) === -1) {
        return res.redirect('/db/o');
    }
    doWithDropboxAccess(req, res, function(req, res) {
        client.readFile(path, {buffer:true}, function(error, data, stat, rangeInfo) {
            var markdown = data.toString();
            Posts.sendMarkdownString(markdown, res);
        });
    });
});

router.get('/q', function(req, res) {
    if (RedirectIf.loggedOut('/db/', req, res)) {
        return;
    }
    doWithDropboxAccess(req, res, function(req, res) {
        client.signOut({}, function() {
            res.redirect('/');
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
        return this._redirectIf(this.status.loggedIn, redirect, res);
    },
    loggedOut: function(redirect, req, res) {
        return this._redirectIf(this.status.loggedOut, redirect, res);
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
    var html = util.format(
        '<li class="Folder  list-group-item">' +
            '<h4 class="fa fa-folder list-group-item-heading"> %s</h4>' +
            '<ul class="list-group">',
        folderName
    );
    Object.keys(structure, function(key, value) {
        var htmlForItem = '';
        if (typeof value === 'string') {
            var isPreviewable = value.endsWith(/\.(md|txt)/);
            var item = key;
            if (isPreviewable) {
                item = util.format('<a href="%s">%s</a>','/db/f?f=' + value, item);
                validFiles.push(value);
            }
            htmlForItem = util.format('<li class="File list-group-item">%s</li>', item);
        } else {
            htmlForItem = foldersAsLinks(key, value, true);
        }
        html += htmlForItem;
    });
    html += '</ul></li>';
    return html;
}