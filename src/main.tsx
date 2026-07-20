import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// 挂载 React 单页应用，网页模拟器的入口从这里开始。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
