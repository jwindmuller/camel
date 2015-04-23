var express = require('express');
var router = express.Router();

var Dropbox = require("dropbox");
var client = new Dropbox.Client({
    key   : process.env.DROPBOX_KEY,
    secret: process.env.DROPBOX_SECRET
});
client.authDriver(
    new Dropbox.AuthDriver.NodeServer({ port: 5001 })
);  
var Logged = {
    IN : true,
    OUT: false
}

router.get('/', function(req, res) {
    if (redirectIf(Logged.IN, '/db/o', res)) {
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
    if (redirectIf(Logged.OUT, '/db/', res)) {
        return;
    }
    client.authenticate(function(error, client) {
        console.log(client);
      if (error) {
        // Replace with a call to your own error-handling code.
        //
        // Don't forget to return from the callback, so you don't execute the code
        // that assumes everything went well.
        return res.send(error);
      }
      res.send('yay');
      // Replace with a call to your own application code.
      //
      // The user authorized your app, and everything went well.
      // client is a Dropbox.Client instance that you can use to make API calls.
      // doSomethingCool(client);
    });
});

module.exports = router;

function redirectIf(status, redirect, res) {
    if (client.isAuthenticated() === status) {
        res.redirect(redirect);
        return true;
    }
    return false;
}