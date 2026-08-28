import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

export interface GoldWebSocketMessage {
  type: string;
  emittedAt: string;
  data: unknown;
}

export interface GoldWebSocketStatus {
  running: boolean;
  path: string;
  clientCount: number;
}

type InitialMessageFactory = () => GoldWebSocketMessage[];

export class GoldWebSocketService {
  private readonly path = process.env.GOLD_WEBSOCKET_PATH || '/ws/gold';
  private server?: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private initialMessageFactory: InitialMessageFactory = () => [];

  attach(httpServer: HttpServer, initialMessageFactory: InitialMessageFactory): void {
    if (this.server) {
      return;
    }

    this.initialMessageFactory = initialMessageFactory;
    this.server = new WebSocketServer({ server: httpServer, path: this.path });
    this.server.on('connection', (client) => {
      this.clients.add(client);
      client.on('close', () => this.clients.delete(client));
      client.on('error', () => this.clients.delete(client));
      for (const message of this.initialMessageFactory()) {
        this.send(client, message);
      }
    });
    this.server.on('error', (error) => {
      console.error('[gold-websocket] server error:', error.message);
    });
  }

  broadcast(type: string, data: unknown): void {
    const message: GoldWebSocketMessage = {
      type,
      emittedAt: new Date().toISOString(),
      data,
    };

    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  getStatus(): GoldWebSocketStatus {
    return {
      running: Boolean(this.server),
      path: this.path,
      clientCount: this.clients.size,
    };
  }

  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    const server = this.server;
    this.server = undefined;
    server?.close();
  }

  private send(client: WebSocket, message: GoldWebSocketMessage): void {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      client.send(JSON.stringify(message));
    } catch (error) {
      console.error('[gold-websocket] send error:', error instanceof Error ? error.message : String(error));
      client.terminate();
      this.clients.delete(client);
    }
  }
}

export const goldWebSocketService = new GoldWebSocketService();
