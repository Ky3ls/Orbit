import LiveConsole from './LiveConsole.jsx';

/** @deprecated Wrapper — nutzt LiveConsole */
export default function ConsoleDrawer(props) {
  return <LiveConsole variant="drawer" {...props} />;
}
