import { createRoot } from 'react-dom/client';
import { CalendarPage } from '../pages/calendar';
import { connectTelegram } from '../shared/telegram';
import './styles.css';

connectTelegram();
createRoot(document.getElementById('root')!).render(<CalendarPage />);
