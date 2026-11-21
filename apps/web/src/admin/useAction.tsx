import { useState } from 'react';
import { errorMessage } from '../lib/api';

export function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText = 'Tersimpan.') => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
      return false;
    }
  };
  const view = msg ? (
    <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`} role={msg.ok ? 'status' : 'alert'}>
      {msg.text}
    </div>
  ) : null;
  return { run, view };
}

