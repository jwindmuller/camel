var CUtils = require('./camel_utils');
var _  = require('underscore');
var maxCacheSize = 50;

module.exports = {
    data : {},
    get: function(key) {
        var data = this.data[key];
        if (data === undefined) {
            data = {};
        }
        return data;
    },
    set: function(key, value) {
        this.data[key] = value;
    },
    empty: function() {
        console.log('Emptying the cache.');
        this.data = {};
    },
    setRenderedPost: function(file, postData) {
        //console.log('Adding to cache: ' + normalizedFileName(file));
        var renderedPosts = this.get('RenderedPosts');
        var fileName = CUtils.normalizedFileName(file);
        renderedPosts[fileName] = _.extend({
            file: fileName,
            date: new Date()
        }, postData);

        if (_.size(renderedPosts) > maxCacheSize) {
            var sorted = _.sortBy(renderedPosts, function (post) { return post.date; });
            delete renderedPosts[sorted.first().file];
        }
        this.set('RenderedPosts', renderedPosts);

        //console.log('Cache has ' + JSON.stringify(_.keys(renderedPosts)));
    },
    getRenderedPost: function(file) {
        var renderedPosts = this.get('RenderedPosts');
        var fileName = CUtils.normalizedFileName(file);
        return renderedPosts[fileName] || null;
    }
}