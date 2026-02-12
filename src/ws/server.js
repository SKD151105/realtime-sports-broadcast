import { WebSocket, WebSocketServer } from 'ws';
import { wsArcjet } from "../arcjet.js";
import { logger } from "../utils/logger.js";

const matchSubscribers = new Map();

function subscribe(matchId, socket) {
    if (!matchSubscribers.has(matchId)) {
        matchSubscribers.set(matchId, new Set());
    }

    matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
    const subscribers = matchSubscribers.get(matchId);

    if (!subscribers) return;

    subscribers.delete(socket);

    if (subscribers.size === 0) {
        matchSubscribers.delete(matchId);
    }
}

function cleanupSubscriptions(socket) {
    if (!socket?.subscriptions) return;
    for (const matchId of socket.subscriptions) {
        unsubscribe(matchId, socket);
    }
}

function sendJson(socket, payload) {
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss, payload) {
    for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        client.send(JSON.stringify(payload));
    }
}

function broadcastToMatch(matchId, payload) {
    const subscribers = matchSubscribers.get(matchId);
    if (!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify(payload);

    for (const client of subscribers) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

function handleMessage(socket, data) {
    let message;

    try {
        message = JSON.parse(data.toString());
    } catch {
        sendJson(socket, { type: 'error', code: 'BAD_JSON', message: 'Invalid JSON' });
        return;
    }

    if (message?.type === 'setSubscriptions' && Array.isArray(message.matchIds)) {
        const nextIds = message.matchIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id));

        cleanupSubscriptions(socket);
        socket.subscriptions = new Set();

        for (const matchId of nextIds) {
            subscribe(matchId, socket);
            socket.subscriptions.add(matchId);
        }

        sendJson(socket, { type: 'subscriptions', matchIds: Array.from(socket.subscriptions) });
        return;
    }

    if (message?.type === 'ping') {
        const id = message?.id ?? message?.pingId;
        const clientTs = message?.clientTs;

        if (id !== undefined || clientTs !== undefined) {
            sendJson(socket, {
                type: 'pong',
                id,
                clientTs,
                serverTs: Date.now(),
            });
        } else {
            sendJson(socket, { type: 'pong' });
        }
        return;
    }

    if (message?.type === "subscribe") {
        const matchId = Number(message.matchId);
        if (!Number.isInteger(matchId)) {
            sendJson(socket, { type: 'error', code: 'BAD_MATCH_ID', message: 'Invalid matchId' });
            return;
        }

        subscribe(matchId, socket);
        socket.subscriptions.add(matchId);
        sendJson(socket, { type: 'subscribed', matchId });
        return;
    }

    if (message?.type === "unsubscribe") {
        const matchId = Number(message.matchId);
        if (!Number.isInteger(matchId)) {
            sendJson(socket, { type: 'error', code: 'BAD_MATCH_ID', message: 'Invalid matchId' });
            return;
        }

        unsubscribe(matchId, socket);
        socket.subscriptions.delete(matchId);
        sendJson(socket, { type: 'unsubscribed', matchId });
    }
}

export function attachWebSocketServer(server) {
    const wss = new WebSocketServer({ noServer: true, path: '/ws', maxPayload: 1024 * 1024 });

    server.on('upgrade', async (req, socket, head) => {
        const { pathname } = new URL(req.url, `http://${req.headers.host}`);

        if (pathname !== '/ws') {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);

                if (decision.isDenied()) {
                    if (decision.reason.isRateLimit()) {
                        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
                    } else {
                        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
                    }
                    socket.destroy();
                    return;
                }
            } catch (e) {
                logger.error('WS upgrade protection error', { error: e });
                socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', async (socket, req) => {
        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });

        socket.subscriptions = new Set();

        sendJson(socket, { type: 'welcome' });

        socket.on('message', (data) => {
            handleMessage(socket, data);
        });

        socket.on('error', (err) => {
            logger.error('WS socket error', { error: err });
            socket.terminate();
        });

        socket.on('close', () => {
            cleanupSubscriptions(socket);
        });
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();

            ws.isAlive = false;
            ws.ping();
        })
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match) {
        broadcastToAll(wss, { type: 'match_created', data: match });
    }

    function broadcastScoreUpdate(matchId, payload) {
        broadcastToMatch(matchId, { type: 'score_update', matchId, data: payload });
    }

    function broadcastCommentary(matchId, comment) {
        broadcastToMatch(matchId, { type: 'commentary', data: comment });
    }

    return { broadcastMatchCreated, broadcastScoreUpdate, broadcastCommentary };
}