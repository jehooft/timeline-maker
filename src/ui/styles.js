/* styles.js — the whole stylesheet, kept in one place so the component tree
   stays readable. Colours are CSS variables because the canvas reads them too. */

export const STYLES = `
        .app {
          --ink: #0D131E; --ink-2: #131B29; --ink-3: #182132; --rule: #2B3648; --faint: #1A2333;
          --text: #C7D2E2; --muted: #6E7F99; --accent: #D9A441; --danger: #C4665A;
          --tint: 0.055; --era-fill: 0.30;
          position: absolute; inset: 0; display: flex; flex-direction: column;
          background: var(--ink); color: var(--text);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          font-size: 13px; overflow: hidden; -webkit-font-smoothing: antialiased;
        }
        .app.light {
          --ink: #F7F5F0; --ink-2: #FFFFFF; --ink-3: #EDE9E1; --rule: #C9C2B4; --faint: #E4DFD4;
          --text: #2A2723; --muted: #7A736A; --accent: #A9762A; --danger: #A8453A;
          --tint: 0.10; --era-fill: 0.42;
        }
        .app.light .card, .app.light .modal, .app.light .drawer, .app.light .help,
        .app.light .search, .app.light .toast { box-shadow: 0 12px 34px rgba(60,50,35,.18); }
        .app.light .btn.primary { color: #FFFDF8; }
        .app.light .modal-veil { background: rgba(60,52,40,.34); }
        .app *, .app *::before, .app *::after { box-sizing: border-box; }
        .app input, .app textarea, .app select, .app button { font-family: inherit; }

        .bar { display: flex; align-items: center; gap: 10px; padding: 10px 14px 8px;
               border-bottom: 1px solid var(--faint); flex-wrap: wrap; flex: none; }
        .brand { font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                 letter-spacing: .16em; text-transform: uppercase; white-space: nowrap; }
        .brand span { color: var(--accent); }
        .jump { display: flex; align-items: center; gap: 6px; }
        .jump input { background: var(--ink-2); border: 1px solid var(--rule); border-radius: 3px;
                      color: var(--text); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
                      padding: 5px 8px; width: 180px; outline: none; }
        .jump input:focus { border-color: var(--accent); }
        .jump input.err, .fld input.err { border-color: var(--danger); }
        .jump input::placeholder { color: var(--muted); }

        .btn { background: var(--ink-2); border: 1px solid var(--rule); color: var(--text);
               font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em;
               text-transform: uppercase; padding: 6px 9px; border-radius: 3px; cursor: pointer; }
        .btn:hover:not(:disabled) { border-color: var(--muted); }
        .btn:disabled { opacity: .38; cursor: default; }
        .btn.small { padding: 5px 7px; font-size: 10px; }
        .btn.primary { background: var(--accent); border-color: var(--accent); color: #10161F; font-weight: 600; }
        .btn.primary:disabled { background: var(--ink-2); border-color: var(--rule); color: var(--muted); }
        .btn.danger { border-color: var(--danger); color: var(--danger); }
        .btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
        .btn:focus-visible, .rail:focus-visible, input:focus-visible, select:focus-visible,
        textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        .readout { margin-left: auto; display: flex; gap: 14px; align-items: baseline;
                   font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
                   color: var(--muted); white-space: nowrap; }
        .readout b { color: var(--text); font-weight: 500; }

        .rail-wrap { padding: 2px 20px 14px; flex: none; }
        .rail { position: relative; height: 26px; cursor: ew-resize; touch-action: none; }
        .rail-track { position: absolute; top: 6px; left: 0; right: 0; height: 1px; background: var(--rule); }
        .rail-grad { position: absolute; top: 0; transform: translateX(-50%); background: none;
                     border: 0; padding: 0; cursor: pointer; display: flex; flex-direction: column;
                     align-items: center; }
        .rail-grad-tick { width: 1px; height: 13px; background: var(--rule); }
        .rail-grad-label { font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
                           letter-spacing: .1em; color: var(--muted); margin-top: 4px; }
        .rail-grad:hover .rail-grad-tick { background: var(--accent); }
        .rail-grad:hover .rail-grad-label { color: var(--accent); }
        .rail-knob { position: absolute; top: 0; width: 3px; height: 13px; background: var(--accent);
                     transform: translateX(-50%); box-shadow: 0 0 8px rgba(217,164,65,.5);
                     pointer-events: none; }

        .main { flex: 1; min-height: 0; display: flex; }
        .stage { position: relative; flex: 1; min-width: 0; }
        canvas.surface { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
        canvas.surface:active { cursor: grabbing; }
        canvas.surface.pointing { cursor: pointer; }

        /* ---- items panel ---- */
        .panel { width: 268px; flex: none; border-right: 1px solid var(--faint);
                 display: flex; flex-direction: column; background: var(--ink); }
        .panel-head { padding: 12px 12px 10px; border-bottom: 1px solid var(--faint); flex: none; }
        .tl-name { width: 100%; background: none; border: 1px solid transparent; color: var(--text);
                   font-size: 14px; font-weight: 600; padding: 4px 6px; border-radius: 3px; outline: none; }
        .tl-name:hover { border-color: var(--faint); }
        .tl-name:focus { border-color: var(--accent); background: var(--ink-2); }
        .panel-actions { display: flex; gap: 5px; margin-top: 9px; }
        .panel-body { flex: 1; overflow-y: auto; padding: 6px 0 12px; }
        .panel-note { flex: none; margin: 0; padding: 9px 12px; border-top: 1px solid var(--faint);
                      font: 9px ui-monospace, monospace; letter-spacing: .09em; text-transform: uppercase;
                      color: var(--muted); opacity: .7; }

        .cat { border-bottom: 1px solid var(--faint); }
        .cat-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 4px; }
        .twist { background: none; border: 0; color: var(--muted); cursor: pointer; width: 18px;
                 font-size: 10px; padding: 2px; }
        .swatch { width: 7px; height: 7px; border-radius: 1px; display: inline-block; flex: none; }
        .cat-name { font: 10px ui-monospace, monospace; letter-spacing: .11em; text-transform: uppercase;
                    color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cat-count { font: 9px ui-monospace, monospace; color: var(--muted); margin-left: auto; flex: none; }
        .cat-tools { display: flex; gap: 1px; flex: none; opacity: 0; transition: opacity .1s; }
        .cat:hover .cat-tools, .cat-tools:focus-within { opacity: 1; }
        .cat-tools button { background: none; border: 0; color: var(--muted); cursor: pointer;
                            font-size: 9px; padding: 3px 3px; line-height: 1; }
        .cat-tools button:hover:not(:disabled) { color: var(--text); }
        .cat-tools button.on { color: var(--accent); }
        .cat-tools button:disabled { opacity: .25; cursor: default; }
        .cat-edit { display: flex; gap: 6px; align-items: center; padding: 0 10px 10px 26px; }
        .cat-edit input[type=text], .cat-edit input:not([type]) {
          flex: 1; min-width: 0; background: var(--ink-2); border: 1px solid var(--rule);
          border-radius: 3px; color: var(--text); font-size: 12px; padding: 4px 6px; outline: none; }
        .cat-edit input[type=color] { width: 26px; height: 24px; padding: 0; border: 1px solid var(--rule);
          background: none; border-radius: 3px; cursor: pointer; flex: none; }

        .cat-items { padding: 0 0 8px 0; }
        .item { display: flex; align-items: center; }
        .item:hover { background: var(--ink-2); }
        .item.sel { background: var(--ink-3); box-shadow: inset 2px 0 0 var(--accent); }
        .item-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
                     background: none; border: 0; color: inherit; cursor: pointer;
                     padding: 5px 4px 5px 26px; text-align: left; }
        .era-mark { width: 12px; height: 5px; border-radius: 1px; flex: none; opacity: .8; }
        .item-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .item-title.key { color: var(--text); font-weight: 600; }
        .item-title.dim { opacity: .55; }
        .item-star { color: var(--accent); font-size: 9px; line-height: 1; flex: none; }
        .item-date { margin-left: auto; font: 9px ui-monospace, monospace; color: var(--muted);
                     flex: none; padding-left: 6px; }
        .item-edit { background: none; border: 0; color: var(--muted); cursor: pointer; padding: 5px 8px;
                     font-size: 10px; opacity: 0; }
        .item:hover .item-edit, .item-edit:focus { opacity: 1; }
        .item-edit:hover { color: var(--text); }
        .empty { margin: 0; padding: 6px 12px 6px 26px; font-size: 11px; color: var(--muted); }

        /* ---- editor drawer ---- */
        .drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 330px;
                  background: var(--ink-2); border-left: 1px solid var(--rule);
                  box-shadow: -18px 0 40px rgba(0,0,0,.45); display: flex; flex-direction: column; z-index: 20; }
        .drawer-head { display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--faint); }
        .drawer-head h2 { margin: 0; font: 600 11px/1 ui-monospace, monospace; letter-spacing: .14em;
                          text-transform: uppercase; }
        .drawer-body { flex: 1; overflow-y: auto; padding: 14px; }
        .drawer-foot { display: flex; gap: 8px; align-items: center; padding: 12px 14px;
                       border-top: 1px solid var(--faint); }
        .fld { display: block; margin-bottom: 14px; }
        .fld > span { display: block; font: 9px ui-monospace, monospace; letter-spacing: .13em;
                      text-transform: uppercase; color: var(--muted); margin-bottom: 5px; }
        .fld > span i { font-style: normal; opacity: .6; text-transform: none; letter-spacing: .04em; }
        .fld input, .fld textarea, .fld select {
          width: 100%; background: var(--ink); border: 1px solid var(--rule); border-radius: 3px;
          color: var(--text); font-size: 12.5px; padding: 6px 8px; outline: none; }
        .fld input, .fld select { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
        .fld textarea { resize: vertical; line-height: 1.5; }
        .fld input:focus, .fld textarea:focus, .fld select:focus { border-color: var(--accent); }
        .fld input::placeholder, .fld textarea::placeholder { color: var(--muted); opacity: .8; }
        .hint { display: block; margin-top: 4px; font: 10px ui-monospace, monospace;
                color: var(--muted); font-style: normal; line-height: 1.4; }
        .hint.ok { color: #7FA88C; }
        .hint.bad { color: var(--danger); }
        .notice { margin: -4px 0 14px; padding: 9px 11px; border-radius: 3px; font-size: 11.5px;
                  line-height: 1.5; border: 1px solid; }
        .notice b { font-weight: 600; }
        .notice.bad { border-color: var(--danger); color: #E39A90; background: rgba(196,102,90,.09); }
        .notice.warn { border-color: #8A7440; color: #D6BC84; background: rgba(217,164,65,.07); }

        .impgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
        .impbtn { background: var(--ink); border: 1px solid var(--rule); border-radius: 3px;
                  color: var(--muted); font: 9px/1.2 ui-monospace, monospace; letter-spacing: .03em;
                  padding: 7px 2px; cursor: pointer; text-align: center; }
        .impbtn:hover { border-color: var(--muted); color: var(--text); }
        .impbtn.on { border-color: var(--accent); background: var(--ink-3); color: var(--accent); font-weight: 600; }

        .symgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
        .symbtn { display: flex; align-items: center; justify-content: center; padding: 5px;
                  background: var(--ink); border: 1px solid var(--rule); border-radius: 3px; cursor: pointer; }
        .symbtn:hover { border-color: var(--muted); }
        .symbtn.on { border-color: var(--accent); background: var(--ink-3); }
        .swatches { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
        .sw { width: 24px; height: 24px; padding: 3px; background: var(--ink); border: 1px solid var(--rule);
              border-radius: 3px; cursor: pointer; }
        .sw span { display: block; width: 100%; height: 100%; border-radius: 1px; }
        .sw.on { border-color: var(--accent); }
        .sw-auto { position: relative; opacity: .55; }
        .sw-custom { width: 24px; height: 24px; padding: 0; border: 1px solid var(--rule);
                     background: none; border-radius: 3px; cursor: pointer; }

        .filebtn { display: inline-block; background: var(--ink); border: 1px dashed var(--rule);
                   border-radius: 3px; padding: 10px 12px; cursor: pointer; width: 100%;
                   text-align: center; font: 11px ui-monospace, monospace; color: var(--muted);
                   letter-spacing: .06em; }
        .filebtn:hover, .filebtn.over { border-color: var(--accent); color: var(--text); }
        .filebtn.over { border-style: solid; }
        .filebtn input { display: none; }
        .linkbtn { margin-top: 6px; width: 100%; }
        .urlrow { display: flex; gap: 6px; margin-top: 6px; }
        .urlrow input { flex: 1; min-width: 0; }
        .imgbox { display: flex; gap: 10px; align-items: flex-start; }
        .imgbox img { width: 76px; height: 60px; object-fit: cover; border-radius: 3px;
                      border: 1px solid var(--rule); flex: none; }
        .imgmeta { min-width: 0; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
        .imgmeta b { font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis;
                     white-space: nowrap; max-width: 190px; }
        .imgmeta em { font: 10px ui-monospace, monospace; color: var(--muted); font-style: normal; }
        .check { display: flex; align-items: center; gap: 7px; margin-top: 9px; cursor: pointer; }
        .check input { width: auto; }
        .check span { font-size: 12px; }

        /* ---- detail card ---- */
        .card { position: absolute; background: var(--ink-2); border: 1px solid var(--rule);
                border-radius: 5px; box-shadow: 0 16px 44px rgba(0,0,0,.6);
                animation: pop .12s ease-out; overflow: hidden; z-index: 15;
                display: flex; flex-direction: column; }
        @keyframes pop { from { opacity: 0; transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
        /* Content scrolls independently of the close button, so a long
           description or a tall picture cannot push the Edit button — or the
           close button itself — off screen. Height is capped and positioned in
           JS, which measures the real content once it has rendered. */
        .card-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }
        .card-scroll > *:not(.card-img) { margin-left: 16px; margin-right: 16px; }
        .card-img { width: 100%; height: 150px; object-fit: cover; display: block;
                    border-bottom: 1px solid var(--rule); }
        .card-x { position: absolute; top: 4px; right: 6px; background: rgba(13,19,30,.7); border: 0;
                  color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer;
                  padding: 2px 6px; border-radius: 3px; }
        .card-x:hover { color: var(--text); }
        .card-cat { display: flex; align-items: center; gap: 6px; margin-top: 14px;
                    font: 9px ui-monospace, monospace; letter-spacing: .13em;
                    text-transform: uppercase; color: var(--muted); }
        .card-star { color: var(--accent); font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
                     border: 1px solid var(--accent); border-radius: 2px; padding: 2px 5px; line-height: 1; }
        .card-star.dim { color: var(--muted); border-color: var(--faint); }
        .card-kind { margin-left: auto; border: 1px solid var(--faint); border-radius: 2px; padding: 2px 5px; }
        .card-title { margin: 7px 16px 10px; font-size: 15px; font-weight: 600; line-height: 1.28;
                      padding-right: 10px; }
        .card-dates { border-top: 1px solid var(--faint); border-bottom: 1px solid var(--faint);
                      padding: 8px 0; margin-bottom: 10px; }
        .card-dates .row { display: flex; justify-content: space-between; gap: 12px;
                           font: 11px ui-monospace, monospace; padding: 2px 0; }
        .card-dates .row span { color: var(--muted); }
        .card-dates .row b { color: var(--text); font-weight: 500; text-align: right; }
        .card-desc { margin: 0 16px 10px; font-size: 12.5px; line-height: 1.55; opacity: .84; }
        .card-within { font: 10px ui-monospace, monospace; color: var(--muted); margin-bottom: 10px;
                       line-height: 1.6; }
        .card-within span { letter-spacing: .11em; text-transform: uppercase; opacity: .8; }
        .card-within em { font-style: normal; color: var(--text); display: block; }
        .chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .chip { font: 9px ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase;
                color: var(--muted); border: 1px solid var(--faint); border-radius: 2px; padding: 2px 5px; }
        .card-actions { display: flex; gap: 6px; margin-top: 12px; }
        .card.preview { pointer-events: none; opacity: .97; }
        .card-links { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
        .card-links a { font: 11px ui-monospace, monospace; color: var(--accent);
                        text-decoration: none; overflow: hidden; text-overflow: ellipsis;
                        white-space: nowrap; }
        .card-links a:hover { text-decoration: underline; }

        /* ---- context menu ---- */
        .ctxmenu { position: absolute; z-index: 36; background: var(--ink-2);
                   border: 1px solid var(--rule); border-radius: 4px; padding: 4px;
                   box-shadow: 0 14px 36px rgba(0,0,0,.55); }
        .ctx-head { margin: 2px 6px 5px; font: 9px ui-monospace, monospace; letter-spacing: .11em;
                    text-transform: uppercase; color: var(--muted); overflow: hidden;
                    text-overflow: ellipsis; white-space: nowrap; }
        .ctxmenu button { display: block; width: 100%; background: none; border: 0;
                          color: var(--text); font: 11px/1 ui-monospace, monospace;
                          text-align: left; padding: 7px 8px; border-radius: 3px; cursor: pointer; }
        .ctxmenu button:hover:not(:disabled) { background: var(--ink-3); }
        .ctxmenu button:disabled { opacity: .35; cursor: default; }
        .ctxmenu button.danger { color: var(--danger); }
        .ctx-sep { display: block; height: 1px; background: var(--faint); margin: 4px 2px; }

        .sizeslider { display: flex; align-items: center; gap: 7px; }
        .sizeslider span { font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
                            color: var(--muted); width: 34px; text-align: right; flex: none; }
        .sizeslider input[type=range] { width: 92px; height: 20px; margin: 0; background: none;
                                         -webkit-appearance: none; appearance: none; cursor: pointer; }
        .sizeslider input[type=range]::-webkit-slider-runnable-track {
          height: 3px; background: var(--rule); border-radius: 2px; }
        .sizeslider input[type=range]::-moz-range-track {
          height: 3px; background: var(--rule); border-radius: 2px; }
        .sizeslider input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4.5px;
          border-radius: 50%; background: var(--accent); border: 0;
          box-shadow: 0 0 0 2px var(--ink-2); }
        .sizeslider input[type=range]::-moz-range-thumb {
          width: 12px; height: 12px; border-radius: 50%; background: var(--accent); border: 0;
          box-shadow: 0 0 0 2px var(--ink-2); }

        canvas.surface.axis-resize { cursor: ns-resize; }

        .help { position: absolute; right: 14px; bottom: 14px; background: var(--ink-2);
                border: 1px solid var(--rule); border-radius: 4px; padding: 14px 16px; max-width: 290px;
                font-size: 12px; line-height: 1.7; color: var(--muted);
                box-shadow: 0 12px 32px rgba(0,0,0,.5); z-index: 12; }
        .help h3 { margin: 0 0 8px; font: 600 10px/1 ui-monospace, monospace; letter-spacing: .16em;
                   text-transform: uppercase; color: var(--text); }
        .help kbd { font: 11px ui-monospace, monospace; color: var(--text); background: var(--ink);
                    border: 1px solid var(--rule); border-radius: 2px; padding: 1px 5px; }
        .help p { margin: 0; }

        .modal-veil { position: fixed; inset: 0; background: rgba(6,10,17,.66);
                      display: flex; align-items: center; justify-content: center; z-index: 40;
                      padding: 20px; }
        .modal { background: var(--ink-2); border: 1px solid var(--rule); border-radius: 6px;
                 width: 100%; max-width: 520px; max-height: 80vh; display: flex;
                 flex-direction: column; box-shadow: 0 24px 60px rgba(0,0,0,.6); }
        .modal-head { display: flex; align-items: center; padding: 14px 18px;
                      border-bottom: 1px solid var(--faint); position: relative; }
        .modal-head h2 { margin: 0; font: 600 11px/1 ui-monospace, monospace;
                         letter-spacing: .15em; text-transform: uppercase; }
        .modal-body { flex: 1; overflow-y: auto; padding: 8px 0; }
        .modal-foot { display: flex; gap: 6px; align-items: center; padding: 12px 18px;
                      border-top: 1px solid var(--faint); flex-wrap: wrap; }
        .tlrow { display: flex; align-items: center; padding: 0 8px 0 18px; }
        .tlrow:hover { background: var(--ink-3); }
        .tlrow.on { box-shadow: inset 3px 0 0 var(--accent); }
        .tlrow-main { flex: 1; min-width: 0; background: none; border: 0; color: inherit;
                      text-align: left; cursor: pointer; padding: 10px 4px; display: flex;
                      flex-direction: column; gap: 3px; }
        .tlrow-main:disabled { cursor: default; opacity: .5; }
        .tlrow-name { font-size: 13px; font-weight: 500; overflow: hidden;
                      text-overflow: ellipsis; white-space: nowrap; }
        .tlrow-meta { font: 10px ui-monospace, monospace; color: var(--muted); }
        .tlrow-tools { display: flex; gap: 2px; flex: none; }
        .tlrow-tools button { background: none; border: 0; color: var(--muted); cursor: pointer;
                              font: 10px ui-monospace, monospace; padding: 5px 7px; border-radius: 3px; }
        .tlrow-tools button:hover:not(:disabled) { color: var(--text); background: var(--ink); }
        .tlrow-tools button:disabled { opacity: .3; cursor: default; }
        .tlrow-tools button.danger { color: var(--danger); }

        .saveflag { font: 9px ui-monospace, monospace; letter-spacing: .1em;
                    text-transform: uppercase; color: var(--muted); white-space: nowrap; }
        .saveflag.warn { color: var(--accent); }

        .search { position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
                  width: min(440px, calc(100% - 28px)); background: var(--ink-2);
                  border: 1px solid var(--rule); border-radius: 5px; z-index: 35;
                  box-shadow: 0 16px 44px rgba(0,0,0,.55); overflow: hidden; }
        .search-bar { display: flex; align-items: center; border-bottom: 1px solid var(--faint); }
        .search-bar input { flex: 1; min-width: 0; background: none; border: 0;
                            color: var(--text); font-size: 14px; padding: 11px 14px; outline: none; }
        .search-bar input::placeholder { color: var(--muted); }
        .search-x { background: none; border: 0; color: var(--muted); cursor: pointer;
                    font-size: 20px; line-height: 1; padding: 6px 14px 8px; flex: none; }
        .search-x:hover { color: var(--text); }
        .search-results { max-height: 320px; overflow-y: auto; padding: 4px 0; }
        .search-row { display: flex; align-items: center; gap: 8px; width: 100%; background: none;
                      border: 0; color: inherit; text-align: left; cursor: pointer; padding: 7px 14px; }
        .search-row.on { background: var(--ink-3); }
        .search-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .search-meta { margin-left: auto; font: 10px ui-monospace, monospace; color: var(--muted);
                       flex: none; padding-left: 8px; }

        /* Deliberately not called "hidden": the host page loads Tailwind, whose
           .hidden utility is display:none, which made the row vanish entirely. */
        .cat > .cat-head > .eye { background: none; border: 0; cursor: pointer; flex: none;
                                  color: var(--muted); font-size: 10px; line-height: 1;
                                  padding: 4px 3px; border-radius: 3px; }
        .cat > .cat-head > .eye:hover { color: var(--text); background: var(--ink-2); }
        .cat > .cat-head > .eye.off { color: var(--accent); }
        .cat.is-off .cat-name { opacity: .45; text-decoration: line-through; }
        .cat.is-off .cat-count { opacity: .45; }

        .toast { position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
                 background: var(--ink-3); border: 1px solid var(--rule); border-radius: 4px;
                 padding: 8px 14px; font: 11px ui-monospace, monospace; letter-spacing: .06em;
                 color: var(--text); box-shadow: 0 8px 24px rgba(0,0,0,.5); z-index: 30; }

        @media (max-width: 860px) {
          .readout { width: 100%; margin-left: 0; gap: 12px; }
          .panel { position: absolute; z-index: 25; top: 0; bottom: 0; left: 0;
                   box-shadow: 18px 0 40px rgba(0,0,0,.45); }
          .drawer { width: 100%; }
          .jump input { width: 130px; }
        }
      `;
