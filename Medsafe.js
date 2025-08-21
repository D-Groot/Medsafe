import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, updateDoc, increment } from 'firebase/firestore';

// Pre-populated interaction data to simulate a database.
const interactionDatabase = {
  "medications": [
    { "name": "Warfarin", "interactions": ["Aspirin", "Ibuprofen", "Ginkgo Biloba", "St. John's Wort"] },
    { "name": "Ibuprofen", "interactions": ["Warfarin", "Hydrochlorothiazide"] },
    { "name": "Aspirin", "interactions": ["Warfarin"] },
    { "name": "Hydrochlorothiazide", "interactions": ["Ibuprofen", "Digoxin"] },
    { "name": "Lisinopril", "interactions": ["Potassium Supplements"] },
    { "name": "Metformin", "interactions": ["Alcohol", "Cimetidine"] },
    { "name": "St. John's Wort", "interactions": ["Warfarin", "Oral Contraceptives"] },
    { "name": "Grapefruit Juice", "interactions": ["Statins", "Nifedipine"] },
    { "name": "Digoxin", "interactions": ["Hydrochlorothiazide", "Licorice"] },
    { "name": "Potassium Supplements", "interactions": ["Lisinopril"] },
  ]
};

// Helper function to convert PCM data to WAV format
const pcmToWav = (pcmData, sampleRate) => {
  const pcm16 = new Int16Array(pcmData);
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);
  
  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + pcm16.length * 2, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, pcm16.length * 2, true);
  
  // Write PCM data
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }
  
  return new Blob([view], { type: 'audio/wav' });
};

const writeString = (view, offset, string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const base64ToArrayBuffer = (base64) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};


const App = () => {
  const [prescriptions, setPrescriptions] = useState([]);
  const [newMed, setNewMed] = useState('');
  const [checkMed, setCheckMed] = useState('');
  const [interactions, setInteractions] = useState([]);
  const [showWarning, setShowWarning] = useState(false);
  const [reminderTime, setReminderTime] = useState('10:00');
  const [isReminderSet, setIsReminderSet] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [userPersona, setUserPersona] = useState('Woman');
  const [ageGroup, setAgeGroup] = useState('Adult');
  const [chatbotMessages, setChatbotMessages] = useState([]);
  const [chatbotInput, setChatbotInput] = useState('');
  const [isChatbotTyping, setIsChatbotTyping] = useState(false);
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userDisplayName, setUserDisplayName] = useState('');
  const [isFirebaseReady, setIsFirebaseReady] = useState(false);
  const [stats, setStats] = useState({ medicationsAdded: 0, interactionChecks: 0 });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [medInfo, setMedInfo] = useState('');
  const [symptomInput, setSymptomInput] = useState('');
  const [symptomResult, setSymptomResult] = useState('');
  const [isGeneratingInfo, setIsGeneratingInfo] = useState(false);

  useEffect(() => {
    // Initialize Firebase and Auth
    const initializeFirebase = async () => {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const firestoreDb = getFirestore(app);
        setDb(firestoreDb);

        onAuthStateChanged(auth, async (user) => {
          if (user) {
            setUserId(user.uid);
            setUserDisplayName(user.displayName || 'Anonymous User');
            setIsFirebaseReady(true);
          } else {
            await signInAnonymously(auth);
          }
        });
      } catch (error) {
        console.error("Error initializing Firebase:", error);
      }
    };

    initializeFirebase();
  }, []);

  useEffect(() => {
    // Set up Firestore listener for prescriptions after Firebase is ready
    if (!isFirebaseReady || !db || !userId) return;

    const prescriptionsCollection = collection(db, `artifacts/${__app_id}/users/${userId}/medications`);
    const unsubscribePrescriptions = onSnapshot(prescriptionsCollection, (snapshot) => {
      const medicationList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
      }));
      setPrescriptions(medicationList);
    }, (error) => {
      console.error("Error fetching prescriptions:", error);
    });

    const statsDoc = doc(db, `artifacts/${__app_id}/users/${userId}/stats/main`);
    const unsubscribeStats = onSnapshot(statsDoc, (docSnapshot) => {
      if (docSnapshot.exists()) {
        setStats(docSnapshot.data());
      } else {
        setStats({ medicationsAdded: 0, interactionChecks: 0 });
      }
    }, (error) => {
      console.error("Error fetching stats:", error);
    });

    return () => {
      unsubscribePrescriptions();
      unsubscribeStats();
    };
  }, [isFirebaseReady, db, userId]);

  const updateStats = async (field) => {
    if (!db || !userId) return;
    const statsDocRef = doc(db, `artifacts/${__app_id}/users/${userId}/stats/main`);
    try {
      await setDoc(statsDocRef, { [field]: increment(1) }, { merge: true });
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
    }
  };

  const addPrescription = async (e) => {
    e.preventDefault();
    const medName = newMed.trim();
    if (medName !== '' && !prescriptions.some(med => med.name === medName)) {
      if (!db || !userId) return;
      try {
        const docRef = doc(collection(db, `artifacts/${__app_id}/users/${userId}/medications`));
        await setDoc(docRef, { name: medName });
        setNewMed('');
        updateStats('medicationsAdded');
      } catch (error) {
        console.error("Error adding prescription:", error);
      }
    }
  };

  const removePrescription = async (medToRemove) => {
    if (!db || !userId) return;
    try {
      await deleteDoc(doc(db, `artifacts/${__app_id}/users/${userId}/medications`, medToRemove.id));
    } catch (error) {
      console.error("Error removing prescription:", error);
    }
  };

  const checkInteractions = (e) => {
    e.preventDefault();
    const formattedCheckMed = checkMed.trim();
    const foundInteractions = [];
    const interactionsData = interactionDatabase.medications;

    prescriptions.forEach(prescription => {
      const interactionEntry = interactionsData.find(m => m.name.toLowerCase() === prescription.name.toLowerCase());
      if (interactionEntry && interactionEntry.interactions.map(i => i.toLowerCase()).includes(formattedCheckMed.toLowerCase())) {
        foundInteractions.push(prescription.name);
      }
    });

    if (foundInteractions.length > 0) {
      setInteractions(foundInteractions);
      setShowWarning(true);
    } else {
      setInteractions([]);
      setShowWarning(false);
    }
    updateStats('interactionChecks');
  };

  const setReminder = () => {
    setIsReminderSet(true);
    const now = new Date();
    const [hours, minutes] = reminderTime.split(':').map(Number);
    const reminderDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
    const timeUntilReminder = reminderDate.getTime() - now.getTime();

    if (timeUntilReminder > 0) {
      setTimeout(() => {
        setShowReminder(true);
        setIsReminderSet(false);
      }, timeUntilReminder);
    } else {
      reminderDate.setDate(reminderDate.getDate() + 1);
      const tomorrowTimeUntilReminder = reminderDate.getTime() - now.getTime();
      setTimeout(() => {
        setShowReminder(true);
        setIsReminderSet(false);
      }, tomorrowTimeUntilReminder);
    }
  };

  const closeReminder = () => {
    setShowReminder(false);
  };

  const speakReminder = async () => {
    setIsSpeaking(true);
    try {
      const payload = {
        contents: [{
          parts: [{ text: "It is time to take your medication. This is a voice reminder from MedSafe." }]
        }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" }
            }
          }
        },
        model: "gemini-2.5-flash-preview-tts"
      };

      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      
      const part = result?.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType = part?.inlineData?.mimeType;

      if (audioData && mimeType && mimeType.startsWith("audio/")) {
        const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
        const pcmData = base64ToArrayBuffer(audioData);
        const wavBlob = pcmToWav(pcmData, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);
        
        const audio = new Audio(audioUrl);
        audio.play();
      } else {
        console.error("Audio data missing or invalid mime type");
      }
    } catch (error) {
      console.error("Error generating or playing voice reminder:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleChatbotSubmit = async (e) => {
    e.preventDefault();
    if (chatbotInput.trim() === '') return;

    const userMessage = { text: chatbotInput, sender: 'user' };
    setChatbotMessages(prevMessages => [...prevMessages, userMessage]);
    setChatbotInput('');
    setIsChatbotTyping(true);

    const prompt = `You are a helpful wellness assistant. The user is a ${userPersona}, and in the ${ageGroup} age group. Provide concise, friendly health advice.
    Do not provide medical diagnosis or substitute professional medical advice.
    User query: ${chatbotInput}`;

    let attempts = 0;
    const maxAttempts = 3;
    const initialDelay = 1000;

    const fetchWithRetry = async (url, options) => {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        if (attempts < maxAttempts) {
          attempts++;
          const delay = initialDelay * Math.pow(2, attempts - 1) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`Retrying API call, attempt ${attempts}`);
          return fetchWithRetry(url, options);
        } else {
          throw error;
        }
      }
    };

    try {
      const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const text = result.candidates[0].content.parts[0].text;
        const botMessage = { text: text, sender: 'bot' };
        setChatbotMessages(prevMessages => [...prevMessages, botMessage]);
      } else {
        const errorMessage = { text: 'Sorry, I could not generate a response. Please try again.', sender: 'bot' };
        setChatbotMessages(prevMessages => [...prevMessages, errorMessage]);
      }
    } catch (error) {
      console.error('API call failed after multiple retries:', error);
      const errorMessage = { text: 'An unexpected error occurred. Please try again later.', sender: 'bot' };
      setChatbotMessages(prevMessages => [...prevMessages, errorMessage]);
    } finally {
      setIsChatbotTyping(false);
    }
  };

  const handleClearChat = () => {
    setChatbotMessages([]);
  };
  
  const handleMedInfo = async (e) => {
    e.preventDefault();
    const medName = newMed.trim();
    if (medName === '') return;
    setIsGeneratingInfo(true);
    setMedInfo('Generating information...');

    const prompt = `Provide a very brief summary for the medication: ${medName}. Do not provide medical advice. Include the common purpose and one or two common side effects.`;
    
    let attempts = 0;
    const maxAttempts = 3;
    const initialDelay = 1000;

    const fetchWithRetry = async (url, options) => {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        if (attempts < maxAttempts) {
          attempts++;
          const delay = initialDelay * Math.pow(2, attempts - 1) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`Retrying API call, attempt ${attempts}`);
          return fetchWithRetry(url, options);
        } else {
          throw error;
        }
      }
    };
    
    try {
      const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'No information found. Please try a different name.';
      setMedInfo(text);
    } catch (error) {
      console.error('API call failed:', error);
      setMedInfo('An error occurred. Please try again later.');
    } finally {
      setIsGeneratingInfo(false);
    }
  };

  const handleSymptomCheck = async (e) => {
    e.preventDefault();
    const symptom = symptomInput.trim();
    if (symptom === '') return;

    setSymptomResult('Checking symptoms...');

    const prompt = `As a helpful health assistant, provide general information about the following symptom: ${symptom}. Do not diagnose or prescribe treatment. Provide a single, concise paragraph with advice on managing the symptom and when to see a doctor.`;
    
    let attempts = 0;
    const maxAttempts = 3;
    const initialDelay = 1000;

    const fetchWithRetry = async (url, options) => {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response;
      } catch (error) {
        if (attempts < maxAttempts) {
          attempts++;
          const delay = initialDelay * Math.pow(2, attempts - 1) + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          console.log(`Retrying API call, attempt ${attempts}`);
          return fetchWithRetry(url, options);
        } else {
          throw error;
        }
      }
    };
    
    try {
      const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
      const payload = { contents: chatHistory };
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not find information. Please describe the symptom in more detail.';
      setSymptomResult(text);
    } catch (error) {
      console.error('API call failed:', error);
      setSymptomResult('An error occurred. Please try again later.');
    }
  };

  const ChatbotMessage = ({ message }) => {
    return (
      <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
        <div className={`rounded-xl px-4 py-2 max-w-[70%] text-sm ${message.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
          {message.text}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white shadow-xl rounded-2xl p-6 md:p-8 space-y-8 border border-gray-200">
        <header className="text-center">
          <h1 className="4xl font-extrabold text-gray-900 leading-tight">MedSafe</h1>
          <p className="mt-2 text-gray-500 font-medium">Your personalized health companion</p>
        </header>

        {/* User Profile & Authentication */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-600">My Profile</h2>
          </div>
          {isFirebaseReady && (
            <div className="text-sm text-gray-700">
              <p>Welcome, **{userDisplayName}**.</p>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className="font-semibold">I am a:</span>
                {['Woman', 'Man', 'Senior Citizen', 'Girl Child'].map(persona => (
                  <button
                    key={persona}
                    onClick={() => setUserPersona(persona)}
                    className={`py-1 px-3 rounded-full text-xs font-bold transition-all ${userPersona === persona ? 'bg-indigo-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-indigo-100 hover:text-indigo-600'}`}
                  >
                    {persona}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className="font-semibold">My age group is:</span>
                {['Child', 'Teenager', 'Adult', 'Elderly'].map(age => (
                  <button
                    key={age}
                    onClick={() => setAgeGroup(age)}
                    className={`py-1 px-3 rounded-full text-xs font-bold transition-all ${ageGroup === age ? 'bg-purple-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-purple-100 hover:text-purple-600'}`}
                  >
                    {age}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="border-t border-gray-200" />

        {/* Real-time Statistics */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Stats Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-yellow-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 11V3H8v8H2v10h20V11h-6zM10 5h4v12h-4V5zm-2 14h4v-2H8v2zm-4 0h2v-2H4v2zm12 0h2v-2h-2v2z" />
            </svg>
            <h2 className="text-xl">Real-time Statistics</h2>
          </div>
          <div className="flex justify-around text-center">
            <div>
              <p className="text-3xl font-bold text-gray-900">{stats.medicationsAdded}</p>
              <p className="text-sm text-gray-500">Meds Added</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{stats.interactionChecks}</p>
              <p className="text-sm text-gray-500">Checks Performed</p>
            </div>
          </div>
        </section>

        <div className="border-t border-gray-200" />

        {/* AI Wellness Chatbot Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* AI Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-green-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm4.5-10.5c-1.52 0-2.75 1.23-2.75 2.75S14.98 15 16.5 15s2.75-1.23 2.75-2.75S18.02 9.5 16.5 9.5zM7.5 9.5c-1.52 0-2.75 1.23-2.75 2.75S5.98 15 7.5 15s2.75-1.23 2.75-2.75S9.02 9.5 7.5 9.5z" />
            </svg>
            <h2 className="text-xl">AI Wellness Assistant</h2>
          </div>
          <div className="bg-gray-100 p-4 rounded-xl space-y-3 h-64 overflow-y-auto flex flex-col-reverse">
            {isChatbotTyping && (
              <div className="flex justify-start">
                <div className="animate-pulse bg-gray-300 rounded-full h-2 w-12" />
              </div>
            )}
            {[...chatbotMessages].reverse().map((msg, index) => (
              <ChatbotMessage key={index} message={msg} />
            ))}
          </div>
          <form onSubmit={handleChatbotSubmit} className="flex space-x-3">
            <input
              type="text"
              value={chatbotInput}
              onChange={(e) => setChatbotInput(e.target.value)}
              placeholder={`Ask about health for a ${userPersona} ${ageGroup.toLowerCase()}...`}
              className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-green-400 focus:outline-none transition-shadow"
            />
            <button type="submit" className="bg-green-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-green-700 transition-colors transform hover:scale-105">
              Send
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              className="bg-gray-400 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-gray-500 transition-colors transform hover:scale-105"
            >
              Clear
            </button>
          </form>
        </section>
        
        <div className="border-t border-gray-200" />

        {/* Medication List Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Pill Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.364 5.636a2 2 0 1 0-2.828 2.828L19.5 13.5l1.414-1.414-2.549-2.549z" />
              <path d="M2.5 11.5l1.414-1.414 7.071 7.071-1.414 1.414L2.5 11.5z" />
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
            <h2 className="text-xl">My Prescriptions</h2>
          </div>
          {!isFirebaseReady ? (
            <p className="text-gray-500 italic">Loading user data...</p>
          ) : (
            <>
              <form onSubmit={addPrescription} className="flex space-x-3">
                <input
                  type="text"
                  value={newMed}
                  onChange={(e) => setNewMed(e.target.value)}
                  placeholder="Add a prescription (e.g., Warfarin)"
                  className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-400 focus:outline-none transition-shadow"
                />
                <button type="submit" className="bg-blue-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-blue-700 transition-colors transform hover:scale-105">
                  Add
                </button>
              </form>
              <ul className="bg-gray-100 p-4 rounded-xl space-y-2 max-h-48 overflow-y-auto">
                {prescriptions.length === 0 ? (
                  <li className="text-gray-400 italic text-sm">No medications added yet.</li>
                ) : (
                  prescriptions.map((med, index) => (
                    <li key={index} className="flex items-center justify-between bg-white p-3 rounded-lg shadow-sm border border-gray-200">
                      <span className="font-medium text-gray-800">{med.name}</span>
                      <button onClick={() => removePrescription(med)} className="text-gray-400 hover:text-red-500 transition-colors text-sm font-semibold">
                        Remove
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </section>

        <div className="border-t border-gray-200" />

        {/* Interaction Checker Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Warning Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.5 17L12 2L1.5 17H22.5ZM12 14C11.45 14 11 14.45 11 15V17C11 17.55 11.45 18 12 18C12.55 18 13 17.55 13 17V15C13 14.45 12.55 14 12 14ZM12 10C11.45 10 11 10.45 11 11V13C11 13.55 11.45 14 12 14C12.55 14 13 13.55 13 13V11C13 10.45 12.55 10 12 10Z" />
            </svg>
            <h2 className="text-xl">Check for Interactions</h2>
          </div>
          <form onSubmit={checkInteractions} className="flex space-x-3">
            <input
              type="text"
              value={checkMed}
              onChange={(e) => setCheckMed(e.target.value)}
              placeholder="New drug or supplement (e.g., Aspirin)"
              className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-red-400 focus:outline-none transition-shadow"
            />
            <button type="submit" className="bg-red-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-red-700 transition-colors transform hover:scale-105">
              Check
            </button>
          </form>
          {checkMed && (
            <div className={`p-4 rounded-xl transition-all duration-300 ${showWarning ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'}`}>
              {showWarning ? (
                <>
                  <p className="flex items-center space-x-2 text-red-700 font-semibold">
                    {/* Warning Icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.5 17L12 2L1.5 17H22.5ZM12 14C11.45 14 11 14.45 11 15V17C11 17.55 11.45 18 12 18C12.55 18 13 17.55 13 17V15C13 14.45 12.55 14 12 14ZM12 10C11.45 10 11 10.45 11 11V13C11 13.55 11.45 14 12 14C12.55 14 13 13.55 13 13V11C13 10.45 12.55 10 12 10Z" />
                    </svg>
                    <span>Potential Interactions Found!</span>
                  </p>
                  <p className="mt-2 text-red-600">
                    Taking **{checkMed}** may interact with the following medications on your list:
                  </p>
                  <ul className="list-disc list-inside mt-2 text-red-600 font-medium">
                    {interactions.map((med, index) => (
                      <li key={index}>{med}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-red-600 text-sm">
                    Always consult a healthcare professional before taking new medications.
                  </p>
                </>
              ) : (
                <p className="flex items-center space-x-2 text-green-700 font-semibold">
                  {/* Checkmark Icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                  <span>No major interactions found with **{checkMed}**.</span>
                </p>
              )}
            </div>
          )}
        </section>

        <div className="border-t border-gray-200" />

        {/* Medication Information Generator Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Info Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-cyan-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
            </svg>
            <h2 className="text-xl">Medication Information</h2>
          </div>
          <form onSubmit={handleMedInfo} className="flex space-x-3">
            <input
              type="text"
              value={newMed}
              onChange={(e) => setNewMed(e.target.value)}
              placeholder="Enter medication name"
              className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-cyan-400 focus:outline-none transition-shadow"
            />
            <button type="submit" disabled={isGeneratingInfo} className={`bg-cyan-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-colors transform hover:scale-105 ${isGeneratingInfo ? 'bg-gray-400 cursor-not-allowed' : 'hover:bg-cyan-700'}`}>
              {isGeneratingInfo ? 'Loading...' : 'Get Info ✨'}
            </button>
          </form>
          {medInfo && (
            <div className="bg-gray-100 p-4 rounded-xl text-sm text-gray-700">
              <p className="font-semibold text-gray-800">Information:</p>
              <p className="mt-1">{medInfo}</p>
            </div>
          )}
          <p className="mt-2 text-red-600 text-sm italic">
            Disclaimer: This information is for educational purposes only. Always consult a healthcare professional.
          </p>
        </section>

        <div className="border-t border-gray-200" />
        
        {/* Symptom Assistant Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Health Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-teal-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5a5.49 5.49 0 0 1 5.5-5.5c2.27 0 4.5 1.76 5.5 3.51a5.49 5.49 0 0 1 5.5-3.51c3.04 0 5.5 2.76 5.5 5.5 0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <h2 className="text-xl">Symptom Assistant</h2>
          </div>
          <form onSubmit={handleSymptomCheck} className="flex space-x-3">
            <input
              type="text"
              value={symptomInput}
              onChange={(e) => setSymptomInput(e.target.value)}
              placeholder="Describe a symptom (e.g., severe headache)"
              className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-teal-400 focus:outline-none transition-shadow"
            />
            <button type="submit" disabled={isGeneratingInfo} className={`bg-teal-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-colors transform hover:scale-105 ${isGeneratingInfo ? 'bg-gray-400 cursor-not-allowed' : 'hover:bg-teal-700'}`}>
              Check ✨
            </button>
          </form>
          {symptomResult && (
            <div className="bg-gray-100 p-4 rounded-xl text-sm text-gray-700">
              <p className="font-semibold text-gray-800">Symptom Information:</p>
              <p className="mt-1">{symptomResult}</p>
            </div>
          )}
          <p className="mt-2 text-red-600 text-sm italic">
            Disclaimer: This information is not medical advice. Consult a doctor for any health concerns.
          </p>
        </section>

        <div className="border-t border-gray-200" />
        
        {/* Reminder Section */}
        <section className="space-y-4">
          <div className="flex items-center space-x-2 text-gray-600 font-semibold">
            {/* Pill Icon */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18.364 5.636a2 2 0 1 0-2.828 2.828L19.5 13.5l1.414-1.414-2.549-2.549z" />
              <path d="M2.5 11.5l1.414-1.414 7.071 7.071-1.414 1.414L2.5 11.5z" />
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
            <h2 className="text-xl">Set a Reminder</h2>
          </div>
          <div className="flex space-x-3">
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="flex-1 p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-400 focus:outline-none transition-shadow"
            />
            <button onClick={setReminder} disabled={isReminderSet} className={`font-bold py-3 px-6 rounded-xl shadow-lg transition-colors transform hover:scale-105 ${isReminderSet ? 'bg-gray-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-700'}`}>
              {isReminderSet ? 'Reminder Set' : 'Set Reminder'}
            </button>
            <button onClick={speakReminder} disabled={isSpeaking} className={`font-bold py-3 px-6 rounded-xl shadow-lg transition-colors transform hover:scale-105 ${isSpeaking ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700'}`}>
              {isSpeaking ? 'Speaking...' : 'Speak Reminder'}
            </button>
          </div>
        </section>

        {/* Reminder Modal */}
        {showReminder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4 text-center">
              <h3 className="2xl font-bold text-gray-900">Medication Time!</h3>
              <p className="text-gray-600">Don't forget to take your medication.</p>
              <button onClick={closeReminder} className="bg-blue-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:bg-blue-700 transition-colors">
                OK
              </button>
            </div>
          </div>
        )}
      </div>
      <footer className="fixed bottom-0 left-0 w-full text-center py-2 text-xs text-gray-400">
        {isFirebaseReady ? `User ID: ${userId}` : 'Connecting to Firebase...'}
      </footer>
    </div>
  );
};

export default App;
