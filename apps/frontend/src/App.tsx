import reactLogo from './assets/react.svg'
import nluxLogo from './assets/nlux.svg'
import './App.css'

import { AiChat, useAsStreamAdapter } from '@nlux/react';
import { send } from './send';
import { personas } from './personas';
import '@nlux/themes/nova.css';

function App() {
  const adapter = useAsStreamAdapter(send, []);

  return (
    <>
      <div>
        <a href="https://docs.nlkit.com/nlux" target="_blank">
          <img src={nluxLogo} className="logo" alt="NLUX logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>NLUX + React</h1>
      <div className="card" style={{minWidth: 420, minHeight: 350}}>
        <AiChat
            adapter={adapter}
            personaOptions={personas}
        />
      </div>
    </>
  )
}

export default App
