import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Live updates.
 *
 * An auction whose clock moves is unusable over polling: a supplier deciding
 * whether to bid needs the countdown they are looking at to be the real one.
 *
 * Clients join a room per RFQ rather than receiving everything. With a hundred
 * live auctions, broadcasting every bid to every connected browser is a lot of
 * traffic about auctions nobody is watching.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  handleConnection() {
    // Nothing to do: clients subscribe explicitly to the auctions they open.
  }

  @SubscribeMessage('watch')
  watch(client: Socket, rfqId: string) {
    client.join(`rfq:${rfqId}`);
    return { watching: rfqId };
  }

  @SubscribeMessage('unwatch')
  unwatch(client: Socket, rfqId: string) {
    client.leave(`rfq:${rfqId}`);
    return { watching: null };
  }

  /** Something changed on this auction: new bid, extension, or close. */
  emitAuctionChanged(rfqId: string, payload: unknown) {
    this.server?.to(`rfq:${rfqId}`).emit('auction:changed', payload);
  }

  /** A change to the list view: status or lowest bid moved. */
  emitListChanged() {
    this.server?.emit('auctions:changed', {});
  }
}
