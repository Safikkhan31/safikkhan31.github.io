import { useEffect, useRef } from 'react';

// Ported from the vanilla frontend's ad slot: the box stays hidden (display:none
// via CSS) until AdSense confirms an ad actually filled it, then flips to flex.
// The adsbygoogle.js loader script itself lives in index.html's <head>.
export default function AdSlot() {
  const slotRef = useRef(null);
  const insRef = useRef(null);

  useEffect(() => {
    const slot = slotRef.current;
    const ins = insRef.current;
    if (!slot || !ins) return;

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      return;
    }

    let checks = 0;
    const iv = setInterval(() => {
      checks++;
      const status = ins.getAttribute('data-ad-status');
      if (status === 'filled') {
        slot.style.display = 'flex';
        clearInterval(iv);
      } else if (status === 'unfilled' || checks > 20) {
        // ~6s: give up quietly, stay hidden
        clearInterval(iv);
      }
    }, 300);

    return () => clearInterval(iv);
  }, []);

  return (
    <div id="adSlot" ref={slotRef}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-1186379176631282"
        data-ad-slot="1529451467"
        data-ad-format="auto"
        data-full-width-responsive="true"
      ></ins>
    </div>
  );
}
