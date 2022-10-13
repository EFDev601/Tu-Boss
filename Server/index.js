const { randomUUID } = require('crypto');
const udp = require('dgram');
const { Server } = require('http');

const server = udp.createSocket("udp4");
var clients = [];

///SERVER EVENTS///
server.on('error', (e) => {
    console.log('server error: ' + e.stack);
});

server.on('message', (msg, rinfo) => {
    //console.log('server got: '+msg+' from '+rinfo.address+':'+rinfo.port);
    //server.send("server|server|opponent-disconnect|opponent refused rematch", clients.get(rematches[i].winner).port, clients.get(rematches[i].winner).ip);
    var sender = {ip: rinfo.address, port: rinfo.port};

    if (!clients.includes(sender)){
        clients.push(sender);
    }

    for (let i = 0; i < clients.length; i++) {
        if (clients[i] != sender){
            server.send(msg.toString(), clients[i].port, clients[i].ip);
        }
    }
});

server.on('listening', () => {
    const address = server.address();
    console.log('server listening '+address.address+':'+address.port);
});

server.bind(6969);
