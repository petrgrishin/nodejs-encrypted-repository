'use strict';

var http = require('http');
var url = require('url');
var qs = require('querystring');
var fs = require('fs');
var crypto = require('crypto');

var Routing = function (server) {
    var route = {};
    this.get = function (name, requestListener) {
        route[name] = requestListener;
    };
    server.on('request', function (req, res) {
        var urlParams = url.parse(req.url, true);
        var urlPathname = urlParams['pathname'];
        var urlQueryParams = urlParams['query'];
        var requestListener = route[urlPathname];
        if (typeof requestListener == "function") {
            requestListener(req, res, urlQueryParams);
            return;
        }
        res.statusCode = 404;
        res.end('Url path not found: ' + urlPathname);
    });
};

var Repository = function (filename) {
    try {
        this.items = require(filename);
    } catch (e) {
        throw new SyntaxError('Загрузка из файла ' + filename + ': ' + e.name + ', ' + e.message);
    }
    this.getAll = function () {
        return this.items;
    };
    this.getByEmail = function (email) {
        return this.items[email];
    };
    this.add = function (email, phone) {
        this.items[email] = phone;
        return this;
    };
    this.save = function () {
        try {
            fs.writeFileSync(filename, JSON.stringify(this.items), 'utf8');
        } catch (e) {
            throw new SyntaxError('Сохранение в файл ' + filename + ': ' + e.name + ', ' + e.message);
        }
    };
};

var Encryption = function (repository) {
    this.getAll = function () {
        //use RSA private key
    };
    this.getByEmail = function (email) {
        var emailHash = crypto.createHash('md5').update(email).digest('hex');
        var decipher = crypto.createDecipher('aes-256-ctr', emailHash);
        var phoneEncryption = repository.getByEmail(emailHash)['phone'];
        return decipher.update(phoneEncryption, 'hex', 'utf8') + decipher.final('utf8');
    };
    this.add = function (email, phone) {
        var emailHash = crypto.createHash('md5').update(email).digest('hex');
        var cipher = crypto.createCipher('aes-256-ctr', emailHash);
        var phoneEncryption = cipher.update(phone, 'utf8', 'hex') + cipher.final('hex');
        repository.add(emailHash, {
            'phone': phoneEncryption,
            'data': null //use RSA public key
        });
        return this;
    };
    this.save = function () {
        repository.save();
    }
};

var clientRepository = new Repository('./clients.json');
var clientEncryptionRepository = new Encryption(clientRepository);

clientEncryptionRepository.add('user@gmail.com', '+7-999-888-77-66');
clientEncryptionRepository.save();

console.log('->', clientRepository.getAll());
console.log('->', clientEncryptionRepository.getByEmail('user@gmail.com'));
