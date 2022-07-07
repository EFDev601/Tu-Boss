const { randomUUID } = require('crypto');
const udp = require('dgram');
const { Server } = require('http');

const server = udp.createSocket("udp4");
var clients = new Map();
var lobbies = new Map();
var games = [];
var rematches = [];

///UTILITY FUNCTIONS///
function parseMessage(msg, ip, port){
    //ID|Name|Event|Message
    var parsedMsg = msg.toString().split("|");
    if (parsedMsg.length != 4) return null;
    return {id: parsedMsg[0], 
            client:{ip:ip, port:port, name:parsedMsg[1], lastPacket:Date.now(), inGame: false}, 
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
            if (client.lastPacket + 300000 < Date.now()){
                client_disconnect(client, key);
            }
        }
    }
    if (games.length > 0) {
        var gameOffset = 0;
        for (let i = 0; i < games.length; i++) {
            //5 seconds
            var j = i - gameOffset;
            if (clients.get(games[j].player1).lastPacket + 5000 < Date.now()){
                server.send("server|server|opponent-disconnect|Opponent has disconected", clients.get(games[j].player2).port, clients.get(games[j].player2).ip);
                
                client_disconnect(clients.get(games[j].player1), games[i].player1);
                gameOffset--;

                continue;
            }
            if (clients.get(games[j].player2).lastPacket + 5000 < Date.now()){
                server.send("server|server|opponent-disconnect|Opponent has disconected", clients.get(games[j].player1).port, clients.get(games[j].player1).ip);
                    
                client_disconnect(clients.get(games[j].player2), games[j].player2);
                gameOffset--;

                continue;
            }
        }
    }
}, 1000);

///SERVER MESSAGE EVENTS///
const ServerEvent = {connect: "connect", createLobby: "create-lobby", joinLobby: "join-lobby", randomQueue: "random-queue", endGame: "end-game", update:"update", cancel: "cancel", rematch: "rematch"}
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

    server.send("server|server|lobby-created|" + lobbyCode, data.client.port, data.client.ip);

    console.log(data.client.name + " has created a lobby");
}

function server_join_lobby(data){
    if (!lobbies.has(data.message.text)){
        server.send("server|server|error-lobby-join|Lobby is either full or does not exist", data.client.port, data.client.ip);
        return;
    }

    var playerID = lobbies.get(data.message.text);
    lobbies.delete(data.message.text);

    games.push({player1: playerID, player2: data.id});

    clients.get(playerID).lastPacket = Date.now();
    clients.get(data.id).lastPacket = Date.now();

    server.send("server|server|start-game|" + clients.get(playerID).name, data.client.port, data.client.ip);
    server.send("server|server|start-game|" + data.client.name, clients.get(playerID).port, clients.get(playerID).ip);

    setTimeout(() => {server_pursue_connection(playerID);}, 1000);
    setTimeout(() => {server_pursue_connection(data.id);}, 1000);

    console.log("Game started between: " + clients.get(playerID).name + " and " + data.client.name);
}

function server_pursue_connection(id){
    if (games.length > 0){
        for (let i = 0; i < games.length; i++) {
            if (games[i].player1 == id && !clients.get(id).inGame){
                //Part of game, no confirmed connection
                console.log("Connection failed with " + id + ", attempting to pursue");
                server.send("server|server|start-game|" + clients.get(games[i].player2).name, clients.get(id).port, clients.get(id).ip);
                setTimeout(() => {server_pursue_connection(id)}, 1000);
                return;
            }
            if (games[i].player2 == id && !clients.get(id).inGame){
                //Part of game, no confirmed connection
                console.log("Connection failed with " + id + ", attempting to pursue");
                server.send("server|server|start-game|" + clients.get(games[i].player1).name, clients.get(id).port, clients.get(id).ip);
                setTimeout(() => {server_pursue_connection(id)}, 1000);
                return;
            }
        }
    }
}

var queue = null;
function randomQueue(data){
    if (queue == null){
        queue = data.id;
    }
    else{
        games.push({player1: queue, player2: data.id});

        clients.get(queue).lastPacket = Date.now();
        clients.get(data.id).lastPacket = Date.now();
        
        server.send("server|server|start-game|" + clients.get(queue).name, data.client.port, data.client.ip);
        server.send("server|server|start-game|" + data.client.name, clients.get(queue).port, clients.get(queue).ip);

        setTimeout(() => {server_pursue_connection(queue);}, 1000);
        setTimeout(() => {server_pursue_connection(data.id);}, 1000);

        console.log("Game started between: " + clients.get(queue).name + " and " + data.client.name);

        queue = null;
    }
}

function server_end_game(data){
    var index = -1;
    for (let i = 0; i < games.length; i++) {
        if (games[i].player1 == data.id){
            index = i;
            server.send("server|server|end-game|You Win", clients.get(games[i].player2).port, clients.get(games[i].player2).ip);
            rematches.push({winner: games[i].player2, loser: games[i].player1});
        }
        if (games[i].player2 == data.id){
            index = i;
            server.send("server|server|end-game|You Win", clients.get(games[i].player1).port, clients.get(games[i].player1).ip);
            rematches.push({winner: games[i].player1, loser: games[i].player2, winConfirm: false, loseConfirm: false});
        }
    }

    if (index != -1){
        games.splice(index, 1);
    }
}

function server_update(data){
    for (let i = 0; i < games.length; i++) {
        if (games[i].player1 == data.id){
            clients.get(data.id).inGame = true;
            server.send("server|" + data.client.name + "|update|" + data.message.text, clients.get(games[i].player2).port, clients.get(games[i].player2).ip);
            return;
        }
        if (games[i].player2 == data.id){
            clients.get(data.id).inGame = true;
            server.send("server|" + data.client.name + "|update|" + data.message.text, clients.get(games[i].player1).port, clients.get(games[i].player1).ip);
            return;
        }
    }
}

function server_cancel(data){
    if (queue == data.id) {
        console.log("Removed " + data.id + " from queue");
        queue = null;
    }

    var v = lobbies.values();
    var k = lobbies.keys();
    for (let i = 0; i < lobbies.size; i++) {
        var value = v.next().value;
        var key = k.next().value;
        if (value == data.id){
            console.log("Removed " + data.id + " from lobby");
            lobbies.delete(key);
            break;
        }
    }

    for (let i = 0; i < games.length; i++) {
        if (data.id == games[i].player1 || data.id == games[i].player2){
            server.send("server|server|opponent-disconnect|Opponent Left", clients.get(games[i].player1).port, clients.get(games[i].player1).ip);
            server.send("server|server|opponent-disconnect|Opponent Left", clients.get(games[i].player2).port, clients.get(games[i].player2).ip);
            games.splice(i, 1);
        }
    }

    for (let i = 0; i < rematches.length; i++) {
        if (data.id == rematches[i].winner || data.id == rematches[i].loser){
            server.send("server|server|opponent-disconnect|opponent refused rematch", clients.get(rematches[i].winner).port, clients.get(rematches[i].winner).ip);
            server.send("server|server|opponent-disconnect|opponent refused rematch", clients.get(rematches[i].loser).port, clients.get(rematches[i].loser).ip);
            rematches.splice(i, 1);
        }
    }
}

function server_rematch(data){
    var existingMatch = false;
    for (let i = 0; i < rematches.length; i++) {
        if (data.id == rematches[i].winner){
            console.log(data.client.name + " wants a rematch");
            rematches[i].winConfirm = true;
            server.send("server|server|rematch|" + clients.get(rematches[i].winner).name + " wants a rematch", clients.get(rematches[i].loser).port, clients.get(rematches[i].loser).ip);
            existingMatch = true;
        }
        if (data.id == rematches[i].loser){
            console.log(data.client.name + " wants a rematch");
            rematches[i].loseConfirm = true;
            server.send("server|server|rematch|" + clients.get(rematches[i].loser).name + " wants a rematch", clients.get(rematches[i].winner).port, clients.get(rematches[i].winner).ip);
            existingMatch = true;
        }
        if (rematches[i].winConfirm && rematches[i].loseConfirm){
            games.push({player1: rematches[i].winner, player2: rematches[i].loser});

            clients.get(rematches[i].winner).lastPacket = Date.now();
            clients.get(rematches[i].loser).lastPacket = Date.now();
            
            server.send("server|server|start-game|" + clients.get(rematches[i].winner).name, clients.get(rematches[i].loser).port, clients.get(rematches[i].loser).ip);
            server.send("server|server|start-game|" + clients.get(rematches[i].loser).name, clients.get(rematches[i].winner).port, clients.get(rematches[i].winner).ip);

            var id1 = rematches[i].winner;
            var id2 = rematches[i].loser;

            setTimeout(() => {server_pursue_connection(id1);}, 1000);
            setTimeout(() => {server_pursue_connection(id2);}, 1000);

            console.log("Game started between: " + clients.get(rematches[i].winner).name + " and " + clients.get(rematches[i].loser).name);

            rematches.splice(i, 1);
        }
    }

    if (!existingMatch){
        console.log("Error With Rematch");
        server.send("server|server|opponent-disconnect|Opponent refused rematch", data.client.port, data.client.ip);
    }
}

function client_disconnect(client, id){
    console.log("Client " + id + " has disconnected");
    server.send("server|server|disconnected|Your connection has timed out", client.port, client.ip);
    
    if (queue == id) queue = null;

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

    if (games.length > 0){
        for (let i = 0; i < games.length; i++) {
            const element = games[i];
            if (element.player1 == id || element.player2 == id){

                games.splice(i, 1);
                break;
            }
        }
    }

    if (rematches.length > 0){
        for (let i = 0; i < rematches.length; i++) {
            if (rematches[i].winner == id || rematches[i].loser == id){
                server.send("server|server|opponent-disconnect|opponent refused rematch", clients.get(rematches[i].winner).port, clients.get(rematches[i].winner).ip);
                server.send("server|server|opponent-disconnect|opponent refused rematch", clients.get(rematches[i].loser).port, clients.get(rematches[i].loser).ip);
                rematches.splice(i, 1);
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
    //console.log('server got: '+msg+' from '+rinfo.address+':'+rinfo.port);
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
                break;
            case ServerEvent.update:
                server_update(parsedMsg);
                break;
            case ServerEvent.cancel:
                server_cancel(parsedMsg);
                break;
            case ServerEvent.randomQueue:
                randomQueue(parsedMsg);
                break;
            case ServerEvent.rematch:
                server_rematch(parsedMsg);
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
