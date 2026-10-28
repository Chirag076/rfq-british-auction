import React from 'react';
import { Route, Routes } from 'react-router-dom';
import AuctionList from './pages/AuctionList.jsx';
import AuctionDetail from './pages/AuctionDetail.jsx';
import CreateRfq from './pages/CreateRfq.jsx';

export default function App() {
  return (
    <div className="wrap">
      <Routes>
        <Route path="/" element={<AuctionList />} />
        <Route path="/new" element={<CreateRfq />} />
        <Route path="/rfq/:id" element={<AuctionDetail />} />
      </Routes>
    </div>
  );
}
