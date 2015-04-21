var fs = require('fs');
var _  = require('underscore');

var metadataMarker = '@@';
var postsRoot = './posts/';

module.exports = {
    fileIsPost: function(file) {
        file = file.replace(/\\/g, '/');
        var postRegex = /^(.\/)?posts\/\d{4}\/\d{1,2}\/\d{1,2}\/(\w|-|\+)*(.redirect|.md)?$/;
        return postRegex.test(file);
    },
    dateFromFilePath: function(file) {
        file = file.replace(/\\/g, '/');
        var parts = file.split('/');
        return new Date(parts[1], parts[2] - 1, parts[3]);
    },
    // Parses the metadata in the file
    parseMetadata: function(lines) {
        var retVal = {};

        lines.each(function (line) {
            line = line.replace(metadataMarker, '');
            line = line.compact();
            if (line.has('=')) {
                var firstIndex = line.indexOf('=');
                retVal[line.first(firstIndex)] = line.from(firstIndex + 1);
            }
        });

        // NOTE: Some metadata is added in generateHtmlAndMetadataForFile().

        // Merge with site default metadata
        Object.merge(retVal, siteMetadata, false, function(key, targetVal, sourceVal) {
            // Ensure that the file wins over the defaults.
            return targetVal;
        });

        return retVal;
    },
    normalizedFileName: function(file) {
        var retVal = file;
        if (file.startsWith('posts')) {
            retVal = './' + file;
        }

        retVal = retVal.replace('.md', '');

        return retVal;
    },
    // Gets all the lines in a post and separates the metadata from the body
    getLinesFromPost: function(file) {
        file = file.endsWith('.md') ? file : file + '.md';
        var data = fs.readFileSync(file, {encoding: 'UTF8'});

        // Extract the pieces
        var lines    = data.lines();
        var metadata = _.filter(lines, function (line) {
            return line.startsWith(metadataMarker);
        });
        var body     = _.difference(lines, metadata).join('\n');

        return {
            metadata: metadata,
            body: body
        };
    },

    replaceMetadata: function(replacements, haystack) {
        _.keys(replacements).each(function (key) {
            // Ensure that it's a global replacement; non-regex treatment is first-only.
            haystack = haystack.replace(new RegExp(metadataMarker + key + metadataMarker, 'g'), replacements[key]);
        });

        return haystack;
    },
    // Gets the external link for this file. Relative if request is
    // not specified. Absolute if request is specified.
    externalFilenameForFile: function(file, request) {
        var hostname = typeof(request) !== 'undefined' ? request.headers.host : '';

        var retVal = hostname.length ? ('http://' + hostname) : '';
        retVal += file.at(0) === '/' && hostname.length > 0 ? '' : '/';
        retVal += file.replace('.md', '').replace(postsRoot, '').replace(postsRoot.replace('./', ''), '');
        return retVal;
    }
}