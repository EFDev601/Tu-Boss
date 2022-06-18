const { randomUUID } = require('crypto');
const udp = require('dgram');

const server = udp.createSocket("udp4");
var clients = new Map();
var lobbies = new Map();
var games = [];

///UTILITY FUNCTIONS///
function parseMessage(msg, ip, port){
    //ID|Name|Event|Message
    var parsedMsg = msg.toString().split("|");
    if (parsedMsg.length != 4) return null;
    return {id: parsedMsg[0], 
            client:{ip:ip, port:port, name:parsedMsg[1], lastPacket:Date.now()}, 
            message:{event: parsedMsg[2], text: parsedMsg[3]}}
}

function validateMessage(data){
    //Check if client exists and client data is correct
    if (clients.has(data.id)) return true;
    return false;
}

//Timeout
setInterval(function () {
    if (clients.size > 0){
        let v = clients.values();
        let k = clients.keys();
        for (let i = 0; i < clients.size; i++) {
            //5 min
            var client = v.next().value;
            var key = k.next().value;
            if (client.lastPacket + 5000/*300000*/ < Date.now()){
                client_disconnect(client, key);
            }
        }
    }
    if (games.length > 0) {
        for (let i = 0; i < games.length; i++) {
            //5 seconds
            if (clients.get(games[i][0]).lastPacket + 5000 < Date.now()){
                server.send("server|server|opponent-disconnect|Opponent has disconected", clients.get(games[i][1]).port, clients.get(games[i][1]).ip);
                
                client_disconnect(clients.get(games[i][0]), games[i][0]);

                games.splice(i, 1);
            }
            if (clients.get(games[i][1]).lastPacket + 5000 < Date.now()){
                server.send("server|server|opponent-disconnect|Opponent has disconected", clients.get(games[i][0]).port, clients.get(games[i][0]).ip);
                    
                client_disconnect(clients.get(games[i][1]), games[i][1]);

                games.splice(i, 1);
            }
        }
    }
}, 1000);

///SERVER MESSAGE EVENTS///
const ServerEvent = {connect: "connect", createLobby: "create-lobby", joinLobby: "join-lobby", randomQueue: "random-queue", endGame: "end-game", update:"update"}
function server_connect(data){
    //Assign an ID and add player to listing
    var uuid = randomUUID();
    clients.set(uuid, data.client);
    data.id = uuid;

    console.log("Player " + data.client.name + " has connected with id " + uuid);

    server.send("server|server|connected|" + uuid, data.client.port, data.client.ip);
}

const codeChars = '0123456789abcdefghijklmnopqrstuvwxyz';
function server_create_lobby(data){
    var lobbyCode = "";

    for (var i = 0; i < 6; i++){
        lobbyCode += codeChars[Math.floor(Math.random() * codeChars.length)];
    }

    lobbies.set(lobbyCode, data.id);

    server.send("server|server|lobby-created|" + lobbyCode, data.client.port, data.client.id);

    console.log(data.client.name + " has created a lobby");
}

function server_join_lobby(data){
    if (!lobbies.has(data.message.text)){
        server.send("server|server|error-lobby-join|Lobby is either full or does not exist", data.client.port, data.client.id);
        return;
    }

    var playerID = lobbies.get(data.message.text);
    lobbies.delete(data.message.text);

    games.push([playerID, data.id]);

    server.send("server|server|start-game|Lobby Joined Successfully", data.client.port, data.client.ip);
    server.send("server|server|start-game|Player Joined Lobby", clients.get(playerID).port, clients.get(playerID).ip);

    console.log("Game started between: " + clients.get(playerID).name + " and " + data.client.name);
}

var queue = null;
function randomQueue(data){
    if (queue == null){
        queue = data.id;
    }
    else{
        games.push([queue, data.id]);

        server.send("server|server|start-game|Opponent Found", data.client.port, data.client.ip);
        server.send("server|server|start-game|Opponent Found", clients.get(queue).port, clients.get(queue).ip);

        queue = null;
    }
}

function server_end_game(data){
    var try1 = games.indexOf([data.id, data.message.text]);
    var try2 = games.indexOf([data.message.text, data.id]);

    if (try1 == -1){
        //try2
        if (try2 == -1){
            //Error
            return;
        }
        games.splice(try2, 1);
    }
    else if (try2 == -1){
        //Error
        return;
    }
    else{
        games.splice(try1, 1);
    }
}

function server_update(data){
    for (let i = 0; i < games.length; i++) {
        if (games[i][0] == data.id){
            server.send("server|" + data.client.name + "|update|" + data.message.text, clients.get(games[i][1]).port, clients.get(games[i][1]).ip);
            break;
        }
        if (games[i][1] == data.id){
            server.send("server|" + data.client.name + "|update|" + data.message.text, clients.get(games[i][0]).port, clients.get(games[i][0]).ip);
            break;
        }
    }
}

function client_disconnect(client, id){
    console.log("Client " + id + " has disconnected");
    server.send("server|server|disconnected|Your connection has timed out", client.port, client.ip);
    
    if (lobbies.size > 0){
        var v = lobbies.values();
        var k = lobbies.keys();
        for (let i = 0; i < lobbies.size; i++) {
            var lobby = v.next().value;
            var key = k.next().value;
            if (lobby == id){
                lobbies.delete(key);
                break;
            }
        }
    }

    clients.delete(id);
}

///SERVER EVENTS///
server.on('error', (e) => {
    console.log('server error: ' + e.stack);
});

server.on('message', (msg, rinfo) => {
    console.log('server got: '+msg+' from '+rinfo.address+':'+rinfo.port);
    var parsedMsg = parseMessage(msg, rinfo.address, rinfo.port);
    
    if (validateMessage(parsedMsg)){
        //Server Events
        clients.get(parsedMsg.id).lastPacket = Date.now();
        switch(parsedMsg.message.event){
            case ServerEvent.createLobby:
                server_create_lobby(parsedMsg);
                break;
            case ServerEvent.joinLobby:
                server_join_lobby(parsedMsg);
                break;
            case ServerEvent.endGame:
                server_end_game(parsedMsg);
            case ServerEvent.update:
                server_update(parsedMsg);
                break;
            default:
                break;
        }
    }
    else if (parsedMsg.message.event == ServerEvent.connect){
        server_connect(parsedMsg);
    }
    else{
        console.log("Unauthorized Message: " + msg);
    }
});

server.on('listening', () => {
    const address = server.address();
    console.log('server listening '+address.address+':'+address.port);
});

server.bind(6969);
