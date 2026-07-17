import React, { useState } from 'react';
import './App.css';
import LabPanel from './LabPanel';

export default function App() {  
  // Panel 1 state
  const [displayBools, setDisplayBools] = useState({
    gridOn: true,             // Displaying the grid
  });

  return (
    <div className="app-layout">
      {/* Main Canvas Area */}
      <div className="canvas-area">
        <LabPanel displayBools={displayBools} />
      </div>
    </div>
  );
}