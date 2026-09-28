# SwineSync

SwineSync is a comprehensive, offline-first swine management application built with React. It helps farm managers and staff track inventory, monitor health, manage breeding, record feeding schedules, and maintain financial records.

## Features
- **Dashboard:** A high-level overview of farm metrics, including feed stock, active pigs, and health alerts.
- **Inventory Management:** Track all pigs, their statuses, pens, and locations.
- **Health Tracking:** Monitor treatments, vaccinations, illnesses, and overall swine health.
- **Breeding Management:** Keep records of breeding cycles, farrowing, and weaning.
- **Fattener Management:** Record sales of fat pigs to monitor revenue and market performance.
- **Feeding Management:** Manage feed inventory, feed consumption, and schedules.
- **Financial Tracking:** Monitor expenses, revenue, and overall profitability.
- **User Management:** Role-based access control for farm staff and managers.
- **Offline Capabilities:** Fully functional without an internet connection. Data is stored locally and synchronized automatically when connectivity is restored.
- **Notifications:** Real-time alerts and system notifications.

## Technologies Used
- **Frontend:** React, Vite
- **Backend & Authentication:** Supabase
- **Offline Storage:** Dexie.js (IndexedDB wrapper)
- **Service Workers & PWA:** Workbox
- **Charts & Data Visualization:** Chart.js & react-chartjs-2
- **Alerts:** SweetAlert2

## Getting Started

### Prerequisites
Ensure you have Node.js installed on your machine.

### Installation
1. Clone the repository and navigate into the project directory (if not already there):
   ```bash
   cd SwineSync-main
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your environment variables by creating a `.env` file in the root directory and adding your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:5173`.

## Offline Functionality
SwineSync is built as a Progressive Web App (PWA) with strong offline capabilities.

- Using **Workbox Background Sync**, changes made while offline are queued and sent to the server automatically when the network connection is re-established.
- Local data caching is handled via **Dexie.js**, ensuring that you can view and edit records seamlessly without an internet connection.