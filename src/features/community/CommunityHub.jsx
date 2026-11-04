import React, { useEffect, useState } from 'react';
import EventsHub from './EventsHub';
import EventView from './EventView';
import EventManage from './EventManage';
import EventEditor from './EventEditor';
import Communities from './Communities';
import OperatorConsole from './OperatorConsole';
import PlatformAdmin from './PlatformAdmin';
import '../features.css';
import './community.css';

// One navigation stack for everything community-related. `start` picks the first
// screen: the golfer's Events home, the course staff Clubhouse, or platform admin.
export default function CommunityHub({ session, roles, getCourseData, active, start = 'events', openEventId, onExit }) {
  const [stack, setStack] = useState([{ name: start }]);
  const push = (v) => setStack(s => [...s, v]);
  const pop = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : (onExit?.(), s)));
  useEffect(() => { setStack([{ name: start }]); }, [start]);
  useEffect(() => { if (openEventId) setStack([{ name: start }, { name: 'event', id: openEventId }]); }, [openEventId]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [stack.length]);

  const top = stack[stack.length - 1];
  const common = { session, roles };
  const openEvent = (id) => push({ name: 'event', id });
  const createEvent = (preset = {}) => push({ name: 'editor', preset });

  switch (top.name) {
    case 'event':
      return <EventView {...common} eventId={top.id} getCourseData={getCourseData} onBack={pop} onManage={(id) => push({ name: 'manage', id })} />;
    case 'manage':
      return <EventManage {...common} eventId={top.id} onBack={pop} onEdit={(id) => push({ name: 'editor', eventId: id })} />;
    case 'editor':
      return <EventEditor {...common} eventId={top.eventId} preset={top.preset} onCancel={pop}
        onSaved={(id) => { roles.reload(); setStack(s => [...s.slice(0, -1).filter(v => !(v.name === 'manage' && v.id === id)), { name: 'manage', id }]); }} />;
    case 'communities':
      return <Communities {...common} active={active} onBack={pop} onOpenEvent={openEvent} onCreateEvent={createEvent} />;
    case 'clubhouse':
      return <OperatorConsole {...common} onBack={pop} onOpenEvent={(id) => push({ name: 'manage', id })} onCreateEvent={createEvent} />;
    case 'platform':
      return <PlatformAdmin {...common} onBack={pop} onChanged={roles.reload} />;
    default:
      return <EventsHub {...common} active={active} onOpen={openEvent} onCreate={() => createEvent()} onCommunities={() => push({ name: 'communities' })} />;
  }
}
