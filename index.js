
const { randomUUID } = require('crypto');
const udp = require('dgram');

const server = udp.createSocket("udp4");
var clients = new Map();
var lobbies = [];
var games = [];

///UTILITY FUNCTIONS///
function parseMessage(msg, ip, port){
    //ID|Name|Event|Message
    var parsedMsg = msg.toString().split("|");
    if (parsedMsg.length != 4) return null;
    return {id: parsedMsg[0], 
            client:{ip:ip, port:port, name:parsedMsg[1]}, 
            message:{event: parsedMsg[2], text: parsedMsg[3]}}
}

function validateMessage(data){
    //Check if client exists and client data is correct
    if (clients.has(data.id)) return true;
    return false;
}

///SERVER MESSAGE EVENTS///
const ServerEvent = {connect: "connect", createLobby: "create-lobby", joinLobby: "join-lobby", endGame: "end-game"}
function server_connect(data){
    //Assign an ID and add player to listing
    var uuid = randomUUID();
    clients.set(uuid, data.client);
    data.id = uuid;

    console.log("Player " + data.client.name + " has connected with id " + uuid);

    server.send("server|server|connected|" + uuid, data.client.port, data.client.ip);
}

function server_create_lobby(data){
    lobbies.push(data.id);

    server.send("server|server|lobby-created|Lobby Created Successfully", data.client.port, data.client.id);

    console.log(data.client.name + " has created a lobby");
}

function server_join_lobby(data){
    var index = lobbies.indexOf(data.message.text);
    if (index == -1){
        server.send("server|server|error-lobby-join|Lobby is either full or does not exist", data.client.port, data.client.id);
        return;
    }

    lobbies.splice(index, 1);

    games.push([data.message.text, data.id]);

    server.send("server|server|start-game|Lobby Joined Successfully", data.client.port, data.client.ip);
    server.send("server|server|start-game|Player Joined Lobby", clients.get(data.message.text).port, clients.get(data.message.text).ip);

    console.log("Game started between: " + clients.get(data.message.text).name + " and " + data.client.name);
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

///SERVER EVENTS///
server.on('error', (e) => {
    console.log('server error: ' + e.stack);
});

server.on('message', (msg, rinfo) => {
    console.log('server got: '+msg+' from '+rinfo.address+':'+rinfo.port);
    var parsedMsg = parseMessage(msg, rinfo.address, rinfo.port);
    
    if (validateMessage(parsedMsg)){
        //Server Events
        switch(parsedMsg.message.event){
            case ServerEvent.createLobby:
                server_create_lobby(parsedMsg);
                break;
            case ServerEvent.joinLobby:
                server_join_lobby(parsedMsg);
                break;
            case ServerEvent.endGame:

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