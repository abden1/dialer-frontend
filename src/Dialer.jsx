import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, User, Users, Clock, Search, X, Pause, Play, Settings } from 'lucide-react';
import { Device } from '@twilio/voice-sdk';

export default function BusinessDialer() {
  // State management
  const [activeTab, setActiveTab] = useState('dialer');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callState, setCallState] = useState('idle'); // idle, dialing, ringing, active, hold
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [currentCall, setCurrentCall] = useState(null);
  const [twilioDevice, setTwilioDevice] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState('initializing');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoDialEnabled, setAutoDialEnabled] = useState(false);
  
  // Sample data (replace with API calls)
  const [contacts] = useState([
    { id: 1, name: 'John Doe', phone: '+1234567890', company: 'Tech Corp', lastCall: '2 days ago', status: 'available' },
    { id: 2, name: 'Jane Smith', phone: '+1987654321', company: 'Design Inc', lastCall: '5 days ago', status: 'busy' },
    { id: 3, name: 'Mike Johnson', phone: '+1122334455', company: 'Sales Co', lastCall: '1 week ago', status: 'available' },
    { id: 4, name: 'Sarah Williams', phone: '+1555666777', company: 'Marketing Plus', lastCall: 'Never', status: 'offline' },
  ]);
  
  const [callQueue] = useState([
    { id: 1, name: 'Sarah Williams', phone: '+1555666777', priority: 'high', waitTime: '2:34' },
    { id: 2, name: 'Tom Brown', phone: '+1888999000', priority: 'medium', waitTime: '1:12' },
    { id: 3, name: 'Lisa Davis', phone: '+1777888999', priority: 'low', waitTime: '0:45' },
  ]);
  
  const [callHistory] = useState([
    { id: 1, name: 'John Doe', phone: '+1234567890', type: 'outbound', duration: '5:23', time: '10:30 AM', date: 'Today' },
    { id: 2, name: 'Jane Smith', phone: '+1987654321', type: 'inbound', duration: '3:15', time: '9:45 AM', date: 'Today' },
    { id: 3, name: 'Unknown', phone: '+1999888777', type: 'missed', duration: '-', time: '8:20 AM', date: 'Yesterday' },
  ]);

  const timerRef = useRef(null);

  // Initialize Twilio Device
  useEffect(() => {
    initializeTwilioDevice();
    
    return () => {
      if (twilioDevice) {
        twilioDevice.destroy();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const initializeTwilioDevice = async () => {
    try {
      // In production, fetch this token from your backend API
      // const response = await fetch('YOUR_BACKEND_URL/api/calls/token');
      // const { token } = await response.json();
      
      // For demo purposes - you need to replace this with actual token from backend
      const token = 'YOUR_TWILIO_TOKEN_HERE';
      
      const device = new Device(token, {
        logLevel: 1,
        codecPreferences: ['opus', 'pcmu'],
      });

      // Device event listeners
      device.on('registered', () => {
        console.log('Twilio Device Ready');
        setDeviceStatus('ready');
      });

      device.on('error', (error) => {
        console.error('Twilio Device Error:', error);
        setDeviceStatus('error');
      });

      device.on('incoming', (call) => {
        console.log('Incoming call from:', call.parameters.From);
        setCurrentCall(call);
        setCallState('ringing');
        setPhoneNumber(call.parameters.From);
        
        // Setup call listeners
        setupCallListeners(call);
      });

      await device.register();
      setTwilioDevice(device);
      
    } catch (error) {
      console.error('Failed to initialize Twilio Device:', error);
      setDeviceStatus('error');
    }
  };

  const setupCallListeners = (call) => {
    call.on('accept', () => {
      console.log('Call accepted');
      setCallState('active');
      startCallTimer();
    });

    call.on('disconnect', () => {
      console.log('Call ended');
      setCallState('idle');
      setCurrentCall(null);
      setCallDuration(0);
      stopCallTimer();
    });

    call.on('cancel', () => {
      console.log('Call cancelled');
      setCallState('idle');
      setCurrentCall(null);
    });

    call.on('reject', () => {
      console.log('Call rejected');
      setCallState('idle');
      setCurrentCall(null);
    });
  };

  // Call timer functions
  const startCallTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const stopCallTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Call control functions
  const makeCall = async (number) => {
    if (!twilioDevice || deviceStatus !== 'ready') {
      alert('Device not ready. Please refresh the page.');
      return;
    }

    try {
      setPhoneNumber(number);
      setCallState('dialing');

      const call = await twilioDevice.connect({
        params: {
          To: number
        }
      });

      setCurrentCall(call);
      setupCallListeners(call);
      
    } catch (error) {
      console.error('Error making call:', error);
      setCallState('idle');
      alert('Failed to make call: ' + error.message);
    }
  };

  const answerCall = () => {
    if (currentCall) {
      currentCall.accept();
    }
  };

  const rejectCall = () => {
    if (currentCall) {
      currentCall.reject();
      setCallState('idle');
      setCurrentCall(null);
    }
  };

  const endCall = () => {
    if (currentCall) {
      currentCall.disconnect();
    }
  };

  const toggleMute = () => {
    if (currentCall) {
      currentCall.mute(!isMuted);
      setIsMuted(!isMuted);
    }
  };

  const handleDialPad = (digit) => {
    if (phoneNumber.length < 15) {
      setPhoneNumber(prev => prev + digit);
    }
    
    // Send DTMF if in active call
    if (callState === 'active' && currentCall) {
      currentCall.sendDigits(digit);
    }
  };

  const handleBackspace = () => {
    setPhoneNumber(prev => prev.slice(0, -1));
  };

  const handleCall = () => {
    if (callState === 'idle' && phoneNumber) {
      makeCall(phoneNumber);
    } else if (callState === 'active') {
      endCall();
    } else if (callState === 'ringing') {
      answerCall();
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.phone.includes(searchQuery) ||
    contact.company.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Dial Pad Component
  const DialPad = () => {
    const buttons = [
      { digit: '1', letters: '' },
      { digit: '2', letters: 'ABC' },
      { digit: '3', letters: 'DEF' },
      { digit: '4', letters: 'GHI' },
      { digit: '5', letters: 'JKL' },
      { digit: '6', letters: 'MNO' },
      { digit: '7', letters: 'PQRS' },
      { digit: '8', letters: 'TUV' },
      { digit: '9', letters: 'WXYZ' },
      { digit: '*', letters: '' },
      { digit: '0', letters: '+' },
      { digit: '#', letters: '' },
    ];

    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Phone number display */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter phone number"
              className="flex-1 text-2xl font-semibold text-gray-800 border-b-2 border-blue-500 focus:outline-none px-2 py-2"
            />
            {phoneNumber && (
              <button
                onClick={handleBackspace}
                className="ml-2 p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="text-sm text-gray-500">
            Device Status: <span className={`font-semibold ${deviceStatus === 'ready' ? 'text-green-600' : 'text-red-600'}`}>
              {deviceStatus}
            </span>
          </div>
        </div>

        {/* Dial pad grid */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {buttons.map(({ digit, letters }) => (
            <button
              key={digit}
              onClick={() => handleDialPad(digit)}
              className="aspect-square rounded-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors flex flex-col items-center justify-center text-xl font-semibold"
            >
              <span className="text-gray-800">{digit}</span>
              {letters && <span className="text-xs text-gray-500">{letters}</span>}
            </button>
          ))}
        </div>

        {/* Call button */}
        <div className="flex justify-center">
          {callState === 'idle' ? (
            <button
              onClick={handleCall}
              disabled={!phoneNumber}
              className="w-16 h-16 rounded-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center shadow-lg transition-colors"
            >
              <Phone className="w-7 h-7 text-white" />
            </button>
          ) : (
            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg transition-colors"
            >
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Active Call Component
  const ActiveCallDisplay = () => {
    if (callState === 'idle') return null;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-96">
          <div className="text-center mb-8">
            <div className="w-20 h-20 rounded-full bg-blue-100 mx-auto mb-4 flex items-center justify-center">
              <User className="w-10 h-10 text-blue-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">{phoneNumber}</h3>
            <p className="text-lg text-gray-600">
              {callState === 'dialing' && 'Calling...'}
              {callState === 'ringing' && 'Incoming Call'}
              {callState === 'active' && formatDuration(callDuration)}
            </p>
          </div>

          {/* Call controls */}
          <div className="flex justify-center space-x-6 mb-6">
            <button
              onClick={toggleMute}
              className={`w-14 h-14 rounded-full ${isMuted ? 'bg-red-500' : 'bg-gray-200'} hover:opacity-80 flex items-center justify-center transition-colors`}
            >
              {isMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-gray-700" />}
            </button>
            
            <button
              onClick={() => setIsSpeaker(!isSpeaker)}
              className={`w-14 h-14 rounded-full ${isSpeaker ? 'bg-blue-500' : 'bg-gray-200'} hover:opacity-80 flex items-center justify-center transition-colors`}
            >
              {isSpeaker ? <Volume2 className="w-6 h-6 text-white" /> : <VolumeX className="w-6 h-6 text-gray-700" />}
            </button>
          </div>

          {/* Answer/Reject or End call */}
          <div className="flex justify-center space-x-4">
            {callState === 'ringing' ? (
              <>
                <button
                  onClick={answerCall}
                  className="px-8 py-3 bg-green-500 hover:bg-green-600 text-white rounded-full font-semibold flex items-center space-x-2"
                >
                  <Phone className="w-5 h-5" />
                  <span>Answer</span>
                </button>
                <button
                  onClick={rejectCall}
                  className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold flex items-center space-x-2"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span>Decline</span>
                </button>
              </>
            ) : (
              <button
                onClick={endCall}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold flex items-center justify-center space-x-2"
              >
                <PhoneOff className="w-5 h-5" />
                <span>End Call</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Contact List Component
  const ContactList = () => (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredContacts.map(contact => (
          <div
            key={contact.id}
            className="p-4 hover:bg-gray-50 rounded-lg cursor-pointer border border-gray-200 transition-colors"
            onClick={() => makeCall(contact.phone)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-800">{contact.name}</h4>
                  <p className="text-sm text-gray-500">{contact.company}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">{contact.phone}</p>
                <p className="text-xs text-gray-500">Last: {contact.lastCall}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Call Queue Component
  const CallQueue = () => (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800 flex items-center space-x-2">
          <Users className="w-6 h-6" />
          <span>Call Queue ({callQueue.length})</span>
        </h2>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">Auto-Dial</span>
          <button
            onClick={() => setAutoDialEnabled(!autoDialEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoDialEnabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoDialEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {callQueue.map(caller => (
          <div key={caller.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-2 h-2 rounded-full ${
                  caller.priority === 'high' ? 'bg-red-500' :
                  caller.priority === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                }`} />
                <div>
                  <h4 className="font-semibold text-gray-800">{caller.name}</h4>
                  <p className="text-sm text-gray-500">{caller.phone}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center space-x-1 text-sm text-gray-600">
                  <Clock className="w-4 h-4" />
                  <span>{caller.waitTime}</span>
                </div>
                <button
                  onClick={() => makeCall(caller.phone)}
                  className="mt-2 px-4 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-full"
                >
                  Answer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Call History Component
  const CallHistory = () => (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center space-x-2">
        <Clock className="w-6 h-6" />
        <span>Recent Calls</span>
      </h2>

      <div className="space-y-2">
        {callHistory.map(call => (
          <div key={call.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  call.type === 'outbound' ? 'bg-green-100' :
                  call.type === 'inbound' ? 'bg-blue-100' : 'bg-red-100'
                }`}>
                  <Phone className={`w-4 h-4 ${
                    call.type === 'outbound' ? 'text-green-600 rotate-45' :
                    call.type === 'inbound' ? 'text-blue-600 -rotate-45' : 'text-red-600'
                  }`} />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-800">{call.name}</h4>
                  <p className="text-sm text-gray-500">{call.phone}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-gray-700">{call.duration}</p>
                <p className="text-xs text-gray-500">{call.time} · {call.date}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Business Dialer</h1>
          <p className="text-gray-600">VoIP Call Center System</p>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="flex border-b">
            {['dialer', 'contacts', 'queue', 'history'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-4 px-6 text-center font-semibold capitalize transition-colors ${
                  activeTab === tab
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {activeTab === 'dialer' && <DialPad />}
            {activeTab === 'contacts' && <ContactList />}
            {activeTab === 'queue' && <CallQueue />}
            {activeTab === 'history' && <CallHistory />}
          </div>

          {/* Stats Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Today's Stats</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Total Calls</span>
                  <span className="text-2xl font-bold text-blue-600">24</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Avg Duration</span>
                  <span className="text-2xl font-bold text-green-600">4:32</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">In Queue</span>
                  <span className="text-2xl font-bold text-yellow-600">{callQueue.length}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <button className="w-full py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold">
                  Import Contacts
                </button>
                <button className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold">
                  Export Call Logs
                </button>
                <button className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-semibold flex items-center justify-center space-x-2">
                  <Settings className="w-5 h-5" />
                  <span>Settings</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Call Overlay */}
      <ActiveCallDisplay />
    </div>
  );
}
