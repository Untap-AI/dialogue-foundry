import reactLogo from './assets/react.svg'
import nluxLogo from './assets/nlux.svg'
// Keeping App.css for now as we migrate
import './App.css'

import { AiChat, useAsStreamAdapter } from '@nlux/react';
import { send } from './send';
import { personas } from './personas';
import '@nlux/themes/nova.css';

function App() {
  const adapter = useAsStreamAdapter(send, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="flex gap-6 mb-4">
        <a href="https://docs.nlkit.com/nlux" target="_blank" className="hover:opacity-80 transition-opacity">
          <img src={nluxLogo} className="h-16 w-auto" alt="NLUX logo" />
        </a>
        <a href="https://react.dev" target="_blank" className="hover:opacity-80 transition-opacity">
          <img src={reactLogo} className="h-16 w-auto animate-spin-slow" alt="React logo" />
        </a>
      </div>
      <h1 className="text-4xl font-bold mb-8 text-center">NLUX + React</h1>
      <div className="w-full max-w-2xl min-h-[350px] p-4 rounded-lg shadow-md">
        <AiChat
            adapter={adapter}
            personaOptions={personas}
        />
      </div>
    </div>
  )
}

export default App
