import Pusher from "pusher";

let pusher: Pusher | null = null;

export function getPusher() {
  if (!pusher) {
    pusher = new Pusher({
      appId: import.meta.env.PUSHER_APP_ID,
      key: import.meta.env.PUSHER_KEY,
      secret: import.meta.env.PUSHER_SECRET,
      cluster: import.meta.env.PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return pusher;
}
