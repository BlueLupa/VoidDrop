import { useEffect, useLayoutEffect, useState, KeyboardEvent, startTransition, useRef, useMemo } from "react";
import "./App.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { openPath } from '@tauri-apps/plugin-opener';
import { save } from '@tauri-apps/plugin-dialog';
import { copyFile } from '@tauri-apps/plugin-fs';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Brain, Trash2, Copy, Check, FileText, ExternalLink, Download, Image as ImageIcon, Orbit, Settings, Radar, RotateCw, CircleQuestionMark } from "lucide-react";
import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { Toaster, toast } from "sonner";
import heic2any from "heic2any";
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { useVirtualizer } from "@tanstack/react-virtual";
import { Canvas, useThree } from '@react-three/fiber';
import { Html, OrthographicCamera } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const placeholders = [
  "Inscribe a thought...",
  "Whisper into the void...",
  "Capture an echo...",
  "Summon a buried memory...",
  "Speak into the silence...",
];

const searchPlaceholders = [
  "Find a fragment...",
  "Seek an echo...",
  "Scan the void...",
  "Filter the silence...",
  "Parse the shadows..."
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function EnterText({ isProcessing, setIsProcessing, notes_n, setNotesN }: any) {
  const [placeholder, setPlaceholder] = useState("");
  const [inputVal, setInputVal] = useState("");
  useEffect(() => {
    const randMsg = placeholders[Math.floor(Math.random() * (placeholders.length))];
    setPlaceholder(randMsg);
  }, [])
  const handleOnKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputVal.trim() !== "") {
      setIsProcessing(true);
      setNotesN(notes_n + 1);
      const payload = inputVal.trim();
      setInputVal("");

      await delay(10);
      try {
        await invoke("process_new_input", { x: payload });

        await delay(1000);
      } catch (err) {
        toast.error("Failed to assimilate fragment", { description: `${err}` })
      } finally {
        setIsProcessing(false);
      }
    }
  }
  const MAX_CHARS = 1000;
  return (<div className="mt-15 w-full max-w-md flex flex-col items-center">
    <div className="group py-6 px-12 flex items-center justify-center cursor-text">
      <input
        autoCorrect="off"
        autoComplete="off"
        type="text"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        placeholder={placeholder}
        onKeyDown={handleOnKeyDown}
        disabled={isProcessing}
        maxLength={1000}
        className="border-white/10 border rounded-xl text-sm placeholder:text-zinc-600 font-mono focus:outline-none focus:ring-white/20 
        w-20 h-0 text-transparent px-0 py-0 transition-all ring-0
        group-hover:px-4 group-hover:py-4 group-hover:h-auto duration-600 group-hover:duration-300 group-hover:text-starlight group-hover:w-80 group-hover:ring-1 group-hover:ring-white/20" />
    </div>
    <div className={`transition-opacity duration-600 font-mono text-[10px] tracking-widest uppercase ${inputVal.length > 0 ? "opacity-50" : "opacity-0"} ${inputVal.length >= MAX_CHARS ? "text-red-500 animate-pulse" : "text-zinc-500"}`}>
      {inputVal.length} / {MAX_CHARS}
    </div>
  </div>)
}

function heic2jpeg(file: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error("MacOS Heic to Jpeg conversion Failed"));
      })
    };
    img.onerror = async () => {
      URL.revokeObjectURL(url);
      try {
        const conv = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.9
        });
        resolve(Array.isArray(conv) ? conv[0] : conv as Blob);
      } catch (err) {
        reject(err);
      }
    }
    img.src = url;
  })
}

function BlackHole({ notes_n, setNotesN }: any) {
  const [isDragging, setIsDragging] = useState(false);
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length == 0) {
      return;
    }

    setIsProcessing(true);

    for (let i = 0; i < files.length; i++) {
      let file: Blob = files[i];
      let fn = files[i].name;
      let ft = files[i].type;

      let laoding_toast = toast.loading("Assimilating...", { description: `${fn}` });

      if (!fn.includes(".")) {
        if (ft === "image/png") fn += ".png";
        else if (ft === "image/jpeg") fn += ".jpg";
        else if (ft === "image/heic") fn += ".heic";
        else if (ft === "application/pdf") fn += ".pdf";
      }

      try {
        if (fn.toLowerCase().endsWith(".heic") || fn.toLowerCase().endsWith(".heif")) {
          file = await heic2jpeg(file);

          fn = fn.replace(/\.heic$|\.heif$/i, "") + ".jpg";
        }

        let buffer = new Uint8Array(await file.arrayBuffer());

        await delay(500);
        await invoke("process_file", { bytes: buffer, fileName: fn });
        await delay(100);
        setIsProcessing(false);
        setNotesN(notes_n + 1)
        toast.dismiss(laoding_toast);
      } catch (err) {
        toast.error("Failed to assimilate file", { description: `${err}` });
      }
    }
  }
  const [isProcessing, setIsProcessing] = useState(false);
  return (<div className="flex flex-col items-center justify-center">
    <div className="relative group cursor-default flex items-center justify-center">
      <div className={`absolute pointer-events-none transform-gpu transition-all duration-700 rounded-full blur-xl
          ${isProcessing
          ? "-inset-10 bg-starlight opacity-100 animate-pulse"
          : "-inset-2 bg-echo opacity-75 group-hover:-inset-6 group-hover:opacity-100"
        }`}>
      </div>
      <div className={`absolute -inset-8 bg-linear-to-br from-echo via-nebula to-event-horizon blur-3xl rounded-full 
      ${isProcessing
          ? "opacity-75"
          : "opacity-0"
        } pointer-events-none transform transform-gpu
        ${isProcessing
          ? "animate-none"
          : "animate-breathe"
        }`} />
      <div className={`absolute -inset-30 bg-nebula blur-3xl rounded-full opacity-20 pointer-events-none transform-gpu`} />
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative h-[max(288px,36vh)] w-[max(288px,36vh)] bg-black rounded-full flex flex-row transition-all duration-400 items-center justify-center overflow-hidden border-white
      ${(isDragging)
            ? "shadow-[inset_0_0_60px_rgba(184,167,255,1.0),0_0_40px_rgba(184,167,255,1.0)] border-3 scale-110"
            : "shadow-[inset_0_0_30px_rgba(150,100,255,1.0),0_0_20px_rgba(220,180,255,1.0)] border-2"
          }`}>
        {/*<span className="font-mono tracking-[1.0em] pl-[1.0em] text-transparent text-lg bg-linear-to-br from-starlight to-nebula bg-clip-text [text-shadow:0_0_15px_rgba(255,255,255,1)]">VoidDrop</span>*/}
      </div>
    </div>
    <EnterText isProcessing={isProcessing} setIsProcessing={setIsProcessing} notes_n={notes_n} setNotesN={setNotesN} />
  </div>);
}

interface Result {
  id: number;
  content: string;
  similarity: number;
  file_type: number;
  time_stamp: string;
}

function formatTime(dateString: string) {
  if (!dateString) return "";

  const newStr = dateString.replace(' ', 'T') + 'Z';
  const past = new Date(newStr).getTime();
  const now = new Date().getTime();

  const seconds = Math.floor(Math.abs(now - past) / 1000);

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w`;

  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo`;

  const years = Math.floor(days / 365);
  return `${years}y`;
}

function DeleteButton({ x, deleteFunction }: any) {
  const [preDelete, setPreDelete] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleDeletionRequest(e: React.MouseEvent) {
    e.stopPropagation()

    if (preDelete) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setPreDelete(false);
      deleteFunction(x.id);
    } else {
      setPreDelete(true);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        setPreDelete(false);
        timerRef.current = null;
      }, 2000);
    }
  }

  return <div className="h-10 w-10 ml-2 flex flex-col items-center justify-center">
    <Trash2
      onClick={handleDeletionRequest}
      size={(preDelete) ? 30 : 20}
      className={`transition-all duration-200 cursor-pointer transform-gpu hover:scale-110 ${(preDelete) ? "stroke-[2.5px] text-red-600 drop-shadow-[0_0_15px_rgba(220,38,38,1)]" : "stroke-1 text-zinc-600 hover:text-red-900"}`} />
  </div>
}

function NoteCard({ x, expandedCard, setExpandedCard, deleteFunction, config, noQuery, noAnim }: any) {

  function handleParentClick() {
    if (expandedCard === x.id) {
      setExpandedCard(-100);
    } else {
      setExpandedCard(x.id);
    }

  }

  async function copyContent() {
    await navigator.clipboard.writeText(x.content);
  }

  return <motion.div
    initial={noAnim ? { opacity: 0, scale: 0.97, y: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
    animate={{ opacity: 1, scale: 0.97, y: 0 }}
    whileHover={{
      scale: 1.0,
      transition: { duration: 0.1, ease: "easeOut" }
    }}
    transition={{
      duration: 0.4,
      ease: "easeIn"
    }}

    className={`w-full bg-liquid border rounded-xl scale-x-97 group overflow-hidden transform-gpu
      ${expandedCard === x.id
        ? "border-nebula"
        : "border-glass-border shadow-none"
      } ${config["glowing_cards"] ? "shadow-[inset_0_0_40px_rgba(133,125,255,0.6)]" : ""}`}>
    <div
      onClick={handleParentClick}
      className="flex flex-row w-full p-4 items-center justify-between cursor-pointer">
      <div className="p-2 rounded-xl border border-glass-border bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]">
        <Brain size={30} className="text-echo" />
      </div>
      <div className={`h-full w-full px-4 font-mono truncate select-none
            ${(expandedCard === x.id)
          ? "bg-transparent text-starlight"
          : "bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text"}
          `}>{x.content}</div>
      <div className="py-1 px-2 rounded-md bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]" >
        <div className="text-opaque-border text-xs font-mono tracking-widest select-none" >Note</div>
      </div>
      {noQuery
        ? <div className="px-6 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{formatTime(x.time_stamp)}</div>
        : <div className="px-4 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{Math.floor(x.similarity * 100)}%</div>
      }
    </div>
    <div className={`grid transition-all duration-400 ease-in-out ${(expandedCard === x.id)
      ? "grid-rows-[1fr] opacity-100"
      : "grid-rows-[0fr] opacity-0"
      }`} >
      <div className="overflow-hidden" >
        <div className="w-full px-20 py-4 font-mono text-sm bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text" >{x.content}</div>
        <div className="w-full px-4 py-4 flex flex-row items-center justify-between">
          <DeleteButton x={x} deleteFunction={deleteFunction} />

          <ActionButton Icon={Copy} clickFN={copyContent} ErrMsg={"Failed to copy Fragment"} styling={"ml-5"} />

          <div className="px-8 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text">{formatTime(x.time_stamp)} ago</div>
        </div>
      </div>
    </div>
  </motion.div>
}

function getExt(file: string): string {
  const ldi = file.lastIndexOf('.');

  if (ldi <= 0) {
    return "File";
  }

  return file.slice(ldi + 1).toLowerCase();
}

function ImageCard({ x, expandedCard, setExpandedCard, deleteFunction, config, noQuery, noAnim }: any) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);

  useEffect(() => {
    async function resolvePath() {
      try {
        const fullPath = await join(await appDataDir(), 'files', x.content);
        const safeUrl = convertFileSrc(fullPath);

        setAssetUrl(safeUrl);
      } catch (err) {
        toast.error("Failed to resolve asset path:", { description: `${err}` });
      }
    }
    resolvePath();

    return () => {
    };
  }, [x.content]);



  const displayName = x.content.slice(16);
  const ext = getExt(x.content);

  function handleParentClick() {
    if (expandedCard === x.id) {
      setExpandedCard(-100);
    } else {
      setExpandedCard(x.id);
    }
  }

  async function openFile() {
    const base_dir = await appDataDir();
    const path = await join(base_dir, 'files', x.content);
    await openPath(path);
  }

  async function downloadFile() {
    const base_dir = await appDataDir();

    const src_path = await join(base_dir, 'files', x.content);
    const dst_path = await save({
      title: "Save File",
      defaultPath: x.content.slice(16)
    });
    if (dst_path) {
      await copyFile(src_path, dst_path);
    }
  }

  return <motion.div
    initial={noAnim ? { opacity: 0, scale: 0.97, y: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
    animate={{ opacity: 1, scale: 0.97, y: 0 }}
    whileHover={{
      scale: 1.0,
      transition: { duration: 0.1, ease: "easeOut" }
    }}
    transition={{
      duration: 0.4,
      ease: "easeIn"
    }}
    className={`w-full bg-liquid border rounded-xl scale-x-97 group overflow-hidden transform-gpu
      ${expandedCard === x.id
        ? "border-nebula"
        : "border-glass-border shadow-none"
      } ${config["glowing_cards"] ? "shadow-[inset_0_0_40px_rgba(133,125,255,0.6)]" : ""}`}>

    <div
      onClick={handleParentClick}
      className="flex flex-row w-full p-4 items-center justify-between cursor-pointer">
      <div className="p-2 rounded-xl border border-glass-border bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]">
        <ImageIcon size={30} className="text-echo" />
      </div>
      <div className={`h-full w-full px-4 font-mono truncate select-none
            ${(expandedCard === x.id)
          ? "bg-transparent text-starlight"
          : "bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text"}
          `}>{displayName}</div>
      <div className="py-1 px-2 rounded-md bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]" >
        <div className="text-opaque-border text-xs font-mono tracking-widest select-none" >{ext}</div>
      </div>
      {noQuery
        ? <div className="px-6 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{formatTime(x.time_stamp)}</div>
        : <div className="px-4 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{Math.floor(x.similarity * 100)}%</div>
      }
    </div>
    <AnimatePresence initial={false}>
      {expandedCard === x.id && (<motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="overflow-hidden">
        <div className="w-full flex flex-row items-center justify-center">
          {!assetUrl
            ? <div className="font-mono tracking-widest select-none text-zinc-600">Loading...</div>
            : <div className="relative w-full border-y border-nebula overflow-hidden bg-black">
              <img src={assetUrl} alt="Fragment Preview" className="w-full" />
              <div className={`absolute inset-0 pointer-events-none ${config["glowing_cards"] ? "shadow-[inset_0_0_40px_rgba(133,125,255,0.6)]" : ""}`} />
            </div>
          }
        </div>
        <div className="w-full px-4 py-4 flex flex-row items-center justify-between">
          <DeleteButton x={x} deleteFunction={deleteFunction} />

          <ActionButton Icon={ExternalLink} clickFN={openFile} ErrMsg={"Failed to open Fragment"} styling={"ml-5"} />

          <ActionButton Icon={Download} clickFN={downloadFile} ErrMsg={"Failed to download Fragment"} styling={"ml-3"} />

          <div className="px-8 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text">{formatTime(x.time_stamp)} ago</div>
        </div>
      </motion.div>)}
    </AnimatePresence>
  </motion.div>
}

function ActionButton({ Icon, clickFN, ErrMsg, styling }: any) {
  const [postClick, setPostClick] = useState(false);
  const clickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function clickEvent(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (!postClick) {
        await clickFN();
        setPostClick(true);

        clickRef.current = setTimeout(() => {
          setPostClick(false);
          clickRef.current = null;
        }, 1200);
      }
    } catch (err) {
      toast.error(`${ErrMsg}`, { description: `${err}` });
    }
  }

  return (<div
    onClick={clickEvent}
    className={`group relative flex ${styling} flex-col items-center justify-center h-10 overflow-hidden flex-1 border-2 transition-all duration-200 
            ${(postClick) ? "border-starlight bg-green-500/60 cursor-default" : "border-nebula cursor-pointer hover:scale-105 bg-[#7C5CFF50]"} rounded-xl`}>
    <AnimatePresence>
      {
        (postClick)
          ? <motion.div
            key={"check"}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [1.1, 1], opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Check
              size={20}
              className="text-starlight pointer-events-none" />
          </motion.div>
          : <motion.div
            key={"default"}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [1.1, 1], opacity: 1 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            exit={{ scale: 0.5, opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Icon
              size={20}
              className="text-opaque-border pointer-events-none" />
          </motion.div>
      }

    </AnimatePresence>
  </div>)
}

function PdfPreview({ url }: any) {
  return (
    <div className="relative w-full h-auto border-y border-nebula overflow-hidden bg-black">
      <Document
        file={url}
        loading={<div className="w-full bg-zinc-800 animate-pulse"></div>}
        error={<div className="text-red-500 text-xs font-mono tracking-widest p-4">Failed to load PDF</div>}>
        <Page
          width={400}
          pageNumber={1}
          renderTextLayer={false}
          renderAnnotationLayer={false}
          className="w-full h-full [&>canvas]:w-full! [&>canvas]:h-full! [&>canvas]:object-cover! pointer-events-none" />
      </Document>
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_50px_rgba(133,125,255,0.7)]" />
    </div>
  )

}

function FileCard({ x, expandedCard, setExpandedCard, deleteFunction, config, noQuery, noAnim }: any) {
  const displayName = x.content.slice(16);
  const ext = getExt(x.content);


  function handleParentClick() {
    if (expandedCard === x.id) {
      setExpandedCard(-100);
    } else {
      setExpandedCard(x.id);
    }

  }

  const [assetUrl, setAssetUrl] = useState<string | null>(null);

  async function openFile() {
    const base_dir = await appDataDir();
    const path = await join(base_dir, 'files', x.content);
    await openPath(path);
  }

  async function downloadFile() {
    const base_dir = await appDataDir();

    const src_path = await join(base_dir, 'files', x.content);
    const dst_path = await save({
      title: "Save File",
      defaultPath: x.content.slice(16)
    });
    if (dst_path) {
      await copyFile(src_path, dst_path);
    }
  }

  const [textContent, setTextContent] = useState<string | null>(null);
  useEffect(() => {
    async function resolvePath() {
      try {
        const fullPath = await join(await appDataDir(), 'files', x.content);
        const safeUrl = convertFileSrc(fullPath);
        setAssetUrl(safeUrl);

        const response = await fetch(safeUrl);
        const text = await response.text();
        setTextContent(text);

      } catch (err) {
        toast.error("Failed to resolve asset path:", { description: `${err}` });
      }
    }
    resolvePath();
  }, [x.content]);

  const isPdf = x.content.toLowerCase().endsWith(".pdf");

  return <motion.div
    initial={noAnim ? { opacity: 0, scale: 0.97, y: 0 } : { opacity: 0, scale: 0.5, y: 20 }}
    animate={{ opacity: 1, scale: 0.97, y: 0 }}
    whileHover={{
      scale: 1.0,
      transition: { duration: 0.1, ease: "easeOut" }
    }}
    transition={{
      duration: 0.4,
      ease: "easeIn"
    }}
    className={`w-full bg-liquid border rounded-xl scale-x-97 group overflow-hidden transform-gpu
      ${expandedCard === x.id
        ? "border-nebula"
        : "border-glass-border shadow-none"
      } ${config["glowing_cards"] ? "shadow-[inset_0_0_40px_rgba(133,125,255,0.6)]" : ""}`}>
    <div
      onClick={handleParentClick}
      className="flex flex-row w-full p-4 items-center justify-between cursor-pointer">
      <div className="p-2 rounded-xl border border-glass-border bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]">
        <FileText size={30} className="text-echo" />
      </div>
      <div className={`h-full w-full px-4 font-mono truncate select-none
            ${(expandedCard === x.id)
          ? "bg-transparent text-starlight"
          : "bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text"}
          `}>{displayName}</div>
      <div className="py-1 px-2 rounded-md bg-[#7C5CFF50] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]" >
        <div className="text-opaque-border text-xs font-mono tracking-widest select-none" >{ext}</div>
      </div>
      {noQuery
        ? <div className="px-6 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{formatTime(x.time_stamp)}</div>
        : <div className="px-4 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight select-none text-transparent bg-clip-text" >{Math.floor(x.similarity * 100)}%</div>}
    </div>

    <AnimatePresence initial={false}>
      {expandedCard === x.id && (<motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="overflow-hidden"><div className="overflow-hidden" >
          {!assetUrl
            ? (config["pdf_previews"] || config["file_previews"]) && (
              <div className="font-mono tracking-widest select-none text-zinc-600 p-4">Loading...</div>
            )
            : isPdf ? (
              config["pdf_previews"]
                ? <PdfPreview url={assetUrl} />
                : <div></div>
            )
              : config["file_previews"] ? (
                <div className="relative w-full h-50 border-y border-nebula overflow-hidden bg-[#040404] p-4 text-xs font-mono text-nebula whitespace-pre-wrap">
                  <div className="absolute left-0 top-0 bottom-0 w-8 bg-black/40 border-r text-center border-glass-border flex flex-col items-center pt-4 text-xs text-zinc-700 select-none z-10">
                    1<br />2<br />3<br />4<br />5<br />6<br />7<br />8<br />9<br />10<br />11<br />12<br />13<br />
                  </div>

                  <div className="pl-10 text-xs text-nebula whitespace-pre-wrap">
                    {textContent || "Loading..."}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-[#040404] to-transparent pointer-events-none z-25" />
                </div>
              ) : <div></div>}
          <div className="w-full px-4 py-4 flex flex-row items-center justify-between">
            <DeleteButton x={x} deleteFunction={deleteFunction} />

            <ActionButton Icon={ExternalLink} clickFN={openFile} ErrMsg={"Failed to open Fragment"} styling={"ml-5"} />

            <ActionButton Icon={Download} clickFN={downloadFile} ErrMsg={"Failed to download Fragment"} styling={"ml-3"} />

            <div className="px-8 font-mono tracking-widest text-xs bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text">{formatTime(x.time_stamp)} ago</div>
          </div>
        </div>
      </motion.div>)
      }

    </AnimatePresence>

  </motion.div>
}

function ResultCard({ x, expandedCard, setExpandedCard, deleteFunction, config, noQuery, noAnim }: any) {
  if (!x) return null;
  if (x.file_type === 0) {
    return (<NoteCard x={x} expandedCard={expandedCard} setExpandedCard={setExpandedCard} deleteFunction={deleteFunction} config={config} noQuery={noQuery} noAnim={noAnim} />)
  } else if (x.file_type === 1) {
    return <FileCard x={x} expandedCard={expandedCard} setExpandedCard={setExpandedCard} deleteFunction={deleteFunction} config={config} noQuery={noQuery} noAnim={noAnim} />;
  } else {
    return <ImageCard x={x} expandedCard={expandedCard} setExpandedCard={setExpandedCard} deleteFunction={deleteFunction} config={config} noQuery={noQuery} noAnim={noAnim} />;
  }
}

function SearchMenu({ notes_n, setNotesN, config }: any) {
  const [placeholder, setPlaceholder] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [expandedCard, setExpandedCard] = useState(0);
  const [show, setShow] = useState(-1);

  useEffect(() => {
    const randMsg = searchPlaceholders[Math.floor(Math.random() * (searchPlaceholders.length))];
    setPlaceholder(randMsg);
  }, [])

  function XhandleClick() {
    startTransition(() => {
      setInputVal("");
      setResults([]);
    });
  }

  const handleOnKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputVal.trim() !== "") {
      e.currentTarget.blur();
      try {
        const delta = await invoke<Result[]>("search", { query: inputVal });
        await delay(300);
        startTransition(() => {
          setResults(delta);
          if (delta && delta.length > 0) {
            setExpandedCard(-1);
          }
        });
      } catch (err) {
        toast.error("Failed to search the void", { description: `${err}` });
      }
    }
  }

  async function removeCard(id: number) {
    setResults(prev => prev.filter((item) => item.id !== id));
    try {
      await invoke("delete_id", { id: id });
      setNotesN(notes_n - 1);
    } catch (err) {
      toast.error("Failed to erase fragment", { description: `${err}` });
    }
  }

  const parentRef = useRef<HTMLDivElement>(null);

  const filteredResults = useMemo(() => {
    if (show === -1) return results;
    return results.filter(item => item.file_type === show);
  }, [results, show])

  const virtualiser = useVirtualizer({
    count: filteredResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 10,
    getItemKey: (index) => filteredResults[index].id
  })

  return (<div className="group absolute right-8 top-0 z-20 h-full w-24 flex items-center justify-end
  hover:w-1/2 focus-within:w-1/2 duration-400 transition-all px-10 overflow-hidden">
    <div
      className="relative backdrop-blur-md rounded-4xl w-0 h-7/16 bg-liquid border-glass-border border transform-gpu backface-hidden perspective:[1000px]
      group-hover:w-full focus-within:w-full group-hover:h-14/16 focus-within:h-14/16 transition-all duration-400 shadow-[0_0_15px_#857dff] overflow-hidden">
      <div className="flex flex-col items-center justify-center h-full py-6 px-6">
        <div className="bg-liquid border border-glass-border rounded-xl w-full h-14 shrink-0 transition-all transform-gpu">
          <div className="flex flex-row h-full items-center px-4 gap-3 justify-center">
            <input
              autoCorrect="off"
              autoComplete="off"
              onKeyDown={handleOnKeyDown}
              placeholder={placeholder}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="h-full w-full placeholder:text-zinc-600 text-starlight font-mono bg-transparent outline-none" />
            <X
              className="text-opaque-border opacity-50 shrink-0 cursor-pointer hover:scale-130 duration-200"
              strokeWidth={1.0}
              onClick={XhandleClick} />
          </div>
        </div>
        <AnimatePresence>
          {(results.length === 0)
            ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.3 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.25 } }}
                className="flex w-full flex-row items-center justify-center h-full transform-gpu">
                <span className="text-center cursor-default select-none text-starlight [text-shadow:0_0_15px_rgba(255,255,255,1)] mr-6
            font-mono tracking-[0.2em] transform-gpu">{notes_n}</span>
                <div
                  className="text-center cursor-default select-none bg-linear-to-r from-echo to-starlight text-transparent bg-clip-text
            font-mono tracking-[0.4em] transform-gpu animate-pulse"> Fragment{(notes_n === 1) ? "" : "s"} Assimilated</div>
              </motion.div>
            )
            : <motion.div
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: 0.25 } }}
              className="flex flex-row items-center justify-center w-full py-4 mt-2 mr-6 transform-gpu">
              <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="All" idx={-1} />
              <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Notes" idx={0} />
              <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Files" idx={1} />
              <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Images" idx={2} />
            </motion.div>}
        </AnimatePresence>
        <div className={`relative flex-1 flex flex-col min-h-0 w-full transform-gpu will-change-transform`}>
          <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-visible pr-2 custom-scrollbar">
            <div style={{
              height: `${virtualiser.getTotalSize()}px`,
              width: "100%",
              position: "relative"
            }}>
              {virtualiser.getVirtualItems().map((v) => (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualiser.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`
                  }}
                  className="py-2"
                >
                  <ResultCard x={filteredResults[v.index]} expandedCard={expandedCard} setExpandedCard={setExpandedCard} deleteFunction={removeCard} config={config} noQuery={false} noAnim={false} />
                </div>
              ))}

            </div>
          </div>
        </div>

      </div>
    </div>
  </div>)
}

function ScreenButton({ screen, setScreen, id, Icon, padding }: any) {
  const isActive = screen === id;
  return (
    <div
      onClick={() => { setScreen(id) }}
      className={`group relative cursor-pointer ${padding}`}>

      <Icon
        size={(isActive) ? 50 : 30}
        strokeWidth={(isActive) ? 1.5 : 1.0}
        className={`transform-gpu transition-all ${(isActive)
          ? "rotate-90 text-nebula"
          : "rotate-0 text-zinc-500 hover:scale-120"
          }`} />
    </div>
  )
}

function SideBar({ screen, setScreen }: any) {
  return <div
    className="flex flex-col items-center justify-center absolute left-8 h-7/8 w-25 bg-liquid border border-nebula transition-all hover:duration-300 ease-out transform-gpu rounded-4xl z-30 overflow-hidden select-none
    shadow-[inset_0_0_20px_rgba(133,125,255,0.6)]">

    <div className="absolute top-1/20 flex flex-col pointer-events-none items-center select-none cursor-default">
      <div className="text-[10px] font-mono tracking-[0.7em] uppercase text-starlight/90 drop-shadow-[0_0_8px_rgba(150,100,255,0.8)] ml-[0.7em]">
        VOID
      </div>
      <div className="text-[9px] font-mono tracking-[0.3em] uppercase text-starlight/40 mt-1 ml-[0.3em]">
        DROP
      </div>
    </div>

    <ScreenButton screen={screen} setScreen={setScreen} id={0} Icon={Orbit} padding={"py-4"} />
    <ScreenButton screen={screen} setScreen={setScreen} id={1} Icon={Radar} padding={"py-4"} />
    <ScreenButton screen={screen} setScreen={setScreen} id={2} Icon={RotateCw} padding={"py-4"} />
    <ScreenButton screen={screen} setScreen={setScreen} id={3} Icon={Settings} padding={"py-4"} />

  </div>
}

function MainScreen({ notes_n, setNotesN, config }: any) {
  return (<div>
    <div data-tauri-drag-region className="absolute inset-0 z-0" />
    <div className="relative z-10 h-full w-full flex flex-row items-center justify-center">
      <BlackHole notes_n={notes_n} setNotesN={setNotesN} />
    </div>
    <SearchMenu notes_n={notes_n} setNotesN={setNotesN} config={config} />
  </div>)
}

function Switch({ cardKey, config, setConfig, customFN }: any) {
  async function toggle() {
    let current = config[cardKey];
    let orig = config;

    const newConfig = {
      ...config,
      [cardKey]: !current
    };
    await setConfig(newConfig);
    try {
      await invoke("update_config", { config: newConfig });
    } catch (err) {
      setConfig(orig);
      toast.error("Failed to update settings", { description: `${err}` });
    }
    if (customFN) {
      await customFN(!current);
    }
  }
  return (
    <div className="flex flex-row items-center justify-center w-full select-none">
      <div className="bg-linear-to-r from-transparent via-nebula/20 drop-shadow-[0_0_8px_rgba(133,125,255,1)] to-transparent h-1 w-full transform-gpu select-none"></div>
      <div
        onClick={toggle}
        className={`h-10 w-25 mr-50 ml-2 shrink-0 ${config[cardKey] ? "bg-event-horizon/40" : "bg-black"} rounded-full border border-glass-border transition-all duration-200 cursor-pointer`}>
        <div className="flex flex-col h-full w-full justify-center">
          <div
            className={`${(config[cardKey])
              ? "translate-x-10.5 bg-nebula shadow-[0_0_48px_#B8A7FF] border border-starlight"
              : "bg-metal/40 shadow-none border-metal border"}
            ml-1 h-8 w-12 rounded-full transition-all duration-200 transform-gpu`} />
        </div>
      </div>
    </div>
  )
}

function SettingsCard({ name, description, cardKey, config, setConfig, customFN }: any) {
  return (
    <div className="flex flex-row w-full items-center justify-between mb-5">
      <div className="flex flex-col shrink-0">
        <div className="font-mono tracking-widest text-transparent bg-linear-to-tr from-starlight to-echo bg-clip-text text-2xl select-none drop-shadow-[0_0_8px_rgba(184,167,255)]">{name}</div>
        <div className="font-mono text-transparent bg-linear-to-tr from-echo/70 to-nebula/70 bg-clip-text text-lg select-none">{description}</div>
      </div>
      <Switch cardKey={cardKey} config={config} setConfig={setConfig} customFN={customFN} />
    </div>
  )
}

interface Config {
  glowing_cards: boolean,
  always_on_top: boolean,
  pdf_previews: boolean,
  file_previews: boolean,
}

function SettingsScreen({ config, setConfig }: any) {
  const [appVersion, setAppVersion] = useState("v0.0.0");

  useEffect(() => {
    getVersion().then((version) => {
      setAppVersion(`v${version}`);
    });
  }, []);

  return (<div className="flex flex-col items-start justify-start mt-8 ml-40">
    <div className="flex flex-col w-full pb-12">
      <div className="font-mono text-transparent bg-linear-to-t from-echo via-starlight to-starlight bg-clip-text tracking-[0.2em] text-5xl pb-2 select-none">Settings</div>
      <div className="h-1 w-full border-none bg-linear-to-r from-echo to-transparent rounded-full transform-gpu drop-shadow-[0_0_16px_rgba(133,125,255,1),0_0_8px_rgba(133,125,255,1)]" />
    </div>
    <SettingsCard name="Glowing Results" description="Adds a soft glow to search nodes" cardKey={"glowing_cards"} config={config} setConfig={setConfig} />
    <SettingsCard name="PDF Previews" description="Shows thumbnails for the first page of PDFs" cardKey={"pdf_previews"} config={config} setConfig={setConfig} />
    <SettingsCard name="File Snippets" description="Displays the leading lines of files inline" cardKey={"file_previews"} config={config} setConfig={setConfig} />
    <SettingsCard name="Floating Window" description="Keeps this window above all others" cardKey={"always_on_top"} config={config} setConfig={setConfig}
      customFN={
        async (other: boolean) => { await getCurrentWindow().setAlwaysOnTop(other) }
      } />

    <div className="absolute bottom-5 font-mono text-transparent bg-linear-to-tr from-echo/40 to-nebula/40 bg-clip-text text-xs select-none">
      void::architect [Lupascu]
    </div>

    <div className="absolute bottom-5 right-10 font-mono text-transparent bg-linear-to-tr from-echo/40 to-nebula/40 bg-clip-text text-xs select-none">{appVersion}</div>
  </div>)
}

function TypeButton({ show, setShow, text, idx, setExpandedCard }: any) {
  return (
    <div
      onClick={() => { setShow(idx); setExpandedCard(-1) }}
      className={`py-1 px-2 mx-4 rounded-xl transform-gpu
      ${show === idx ? "bg-[#7d5cff7d] shadow-[inset_0_0_20px_rgba(124,92,255,0.4),0_0_20px_rgba(124,92,255,0.4)]" : "bg-[#7d5cff2d] shadow-none opacity-50"}
       border border-glass-border transition-all duration-500 hover:scale-110`} >
      <div className={`${show === idx ? "text-starlight" : "text-starlight/30"} transition-all duration-500 font-mono tracking-widest select-none`} >{text}</div>
    </div>
  )
}

function ArchiveScreen({ config, notes_n, setNotesN }: any) {
  const [results, setResults] = useState<Result[]>([]);
  const [expandedCard, setExpandedCard] = useState(-1);
  const [show, setShow] = useState(-1);
  const [canScroll, setCanScroll] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const getResults = async () => {
      try {
        const delta = await invoke<Result[]>("fetch_all");
        await delay(300);
        startTransition(() => {
          setResults(delta);
          if (delta && delta.length > 0) {
            setExpandedCard(-1);
          }
        });
      } catch (err) {
        toast.error("Failed to retrieve Fragments", { description: `${err}` });
      }
    }
    getResults();
  }, []);

  async function removeCard(id: number) {
    setResults(prev => prev.filter((item) => item.id !== id));
    try {
      await invoke("delete_id", { id: id });
      setNotesN(notes_n - 1);
    } catch (err) {
      toast.error("Failed to erase fragment", { description: `${err}` });
    }
  }

  const filteredResults = useMemo(() => {
    if (show === -1) return results;
    return results.filter(item => item.file_type === show);
  }, [results, show])

  const virtualiser = useVirtualizer({
    count: filteredResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 10,
    getItemKey: (index) => filteredResults[index].id
  })

  const { scrollYProgress } = useScroll({ container: parentRef });
  const bottomFogOpacity = useTransform(scrollYProgress, (progress) => {
    return 1.0 - progress
  });

  const topFogOpacity = useTransform(scrollYProgress, (progress) => {
    return progress
  });

  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTo(0, 0);
    }
  }, [show]);

  useEffect(() => {
    if (!parentRef.current) return;

    const checkOverflow = () => {
      const hasOverflow = parentRef.current!.scrollHeight > parentRef.current!.clientHeight;
      setCanScroll(hasOverflow);
    };

    checkOverflow();

    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [virtualiser.getTotalSize()]);

  return (
    <div className="flex flex-col items-start justify-start mt-8 ml-40 h-full">
      <div className="flex flex-col w-full pb-8">
        <div className="font-mono text-transparent bg-linear-to-t from-echo via-starlight to-starlight bg-clip-text tracking-[0.2em] text-5xl pb-2 select-none">All Fragments</div>
        <div className="h-1 w-full border-none bg-linear-to-r from-echo to-transparent rounded-full transform-gpu drop-shadow-[0_0_16px_rgba(133,125,255,1),0_0_8px_rgba(133,125,255,1)]" />
      </div>

      <div className="flex flex-row items-center justify-center w-full pb-4">
        <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="All" idx={-1} />
        <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Notes" idx={0} />
        <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Files" idx={1} />
        <TypeButton show={show} setShow={setShow} setExpandedCard={setExpandedCard} text="Images" idx={2} />
      </div>

      <div className="bg-linear-to-r from-transparent via-nebula drop-shadow-[0_0_12px_rgba(133,125,255,1)] z-70 to-transparent h-1 w-full transform-gpu select-none" />

      <div className={`relative flex-1 flex flex-col min-h-0 w-full mt-0 border-t border-nebulatransform-gpu will-change-transform`}>

        {canScroll && (
          <motion.div
            style={{ opacity: topFogOpacity }}
            className="absolute top-0 left-0 right-0 bg-linear-to-b from-void to-transparent h-20 z-20 pointer-events-none"
          />
        )}
        {canScroll && (
          <motion.div
            style={{ opacity: bottomFogOpacity }}
            className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-void to-transparent h-20 z-20 pointer-events-none"
          />
        )}
        <div ref={parentRef} className="flex-1 overflow-y-auto overflow-x-visible pr-2 custom-scrollbar">
          <div style={{
            height: `${virtualiser.getTotalSize()}px`,
            width: "100%",
            position: "relative"
          }}>
            {virtualiser.getVirtualItems().map((v) => (
              <div
                key={v.key}
                data-index={v.index}
                ref={virtualiser.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`
                }}
                className="py-2"
              >
                <ResultCard x={filteredResults[v.index]} expandedCard={expandedCard} setExpandedCard={setExpandedCard} deleteFunction={removeCard} config={config} noQuery={true} noAnim={false} />
              </div>
            ))}

          </div>
        </div>
      </div>
    </div>
  )

}

interface Star {
  x: number,
  y: number,
  frag: Result
}

function GalaxyScene({ rect, config }: any) {
  const [hoveredStar, setHoveredStar] = useState<number | null>(null);
  const [visibleStar, setVisibleStar] = useState<number | null>(null);
  const [results, setResults] = useState<Star[]>([]);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hoveredStar !== null) setVisibleStar(hoveredStar);
  }, [hoveredStar]);

  const { raycaster } = useThree();

  useEffect(() => {
    raycaster.params.Points = { threshold: 0.2 };
    return () => { raycaster.params.Points = { threshold: 0.15 }; };
  }, [raycaster]);

  useEffect(() => {
    const getResults = async () => {
      try {
        const delta = await invoke<Star[]>("plot_all");
        startTransition(() => {
          setResults(delta);
        });
      } catch (err) {
        toast.error("Failed to retrieve Fragments", { description: `${err}` });
      }
    }
    getResults();
  }, []);

  const { camera, size } = useThree();

  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;

    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.2, "rgba(255,255,255,0.8)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(canvas);
  }, []);

  const positions = useMemo(() => {
    const vec = new THREE.Vector3(0, 0, 0);
    const arr = new Float32Array(results.length * 3);
    for (let i = 0; i < results.length; i++) {
      const s = results[i];
      const px =
        rect.left + ((s.x + 1) * 0.5) * rect.width;
      const py =
        rect.top + (1 - ((s.y + 1) * 0.5)) * rect.height;
      const ndcX = (px / size.width) * 2 - 1;
      const ndcY = -(py / size.height) * 2 + 1;

      vec.set(ndcX, ndcY, 0);
      vec.unproject(camera);
      arr[i * 3 + 0] = vec.x;
      arr[i * 3 + 1] = vec.y;
      arr[i * 3 + 2] = 0;
    }

    return arr;
  }, [rect, camera, size, results]);

  const geomRef = useRef<THREE.BufferGeometry>(null);
  const isLeftSide = visibleStar !== null && positions[visibleStar * 3] < 0;

  useEffect(() => {
    if (geomRef.current && positions.length > 0) {
      geomRef.current.computeBoundingSphere();
    }
  }, [positions]);

  return (
    <>
      <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={100} />
      <points
        onPointerOut={() => {
          hoverTimeout.current = setTimeout(() => {
            setHoveredStar(null);
            document.body.style.cursor = "default";
          }, 50);
        }}

        onPointerMove={(e) => {
          e.stopPropagation();
          if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          if (e.index !== undefined) {
            setHoveredStar(e.index);
            document.body.style.cursor = "pointer";
          }
        }}
      >
        <bufferGeometry ref={geomRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>

        <pointsMaterial
          size={8}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          map={texture}
          alphaTest={0.001}
          color={[3.0, 3.0, 3.0]}
          sizeAttenuation={false}
        />
      </points >
      {visibleStar !== null && (
        <Html style={{ pointerEvents: 'none' }} occlude={false} zIndexRange={[100, 0]}
          position={[
            positions[visibleStar * 3],
            positions[visibleStar * 3 + 1],
            positions[visibleStar * 3 + 2],
          ]}
        >
          <div style={{ position: 'relative' }}>
            <AnimatePresence onExitComplete={() => setVisibleStar(null)}>
              {hoveredStar !== null && (
                <motion.div
                  key="star-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="pointer-events-none w-100"
                  style={{
                    position: 'absolute',
                    bottom: '20px',
                    ...(isLeftSide
                      ? { left: '20px' }
                      : { right: '20px' }
                    )
                  }}
                >
                  <ResultCard x={results[visibleStar].frag} expandedCard={-1}
                    setExpandedCard={() => { }} deleteFunction={() => { }} config={config} noQuery={true} noAnim={true}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Html>
      )}

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.01}
          intensity={10}
        />
      </EffectComposer>
    </>
  );
}

function GalaxyMap({ rect, config }: any) {
  return (
    <div className="fixed inset-0 z-0">
      <Canvas gl={{ alpha: true }}>
        <color attach="background" args={["#090714"]} />
        <GalaxyScene rect={rect} config={config} />
      </Canvas>
    </div>
  );
}

function LatentSpaceScreen({ config }: any) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      if (ref.current) {
        setRect(ref.current.getBoundingClientRect());
      }
    };
    update();
    const ro = new ResizeObserver(update);

    if (ref.current) {
      ro.observe(ref.current);
    }

    window.addEventListener("resize", update);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return ((<div className="relative flex flex-col items-start justify-start pl-40 h-full box-border overflow-hidden">
    <div className="flex flex-col w-full pt-8 pb-12 z-70 pointer-events-none">
      <div className="font-mono text-transparent bg-linear-to-t from-echo via-starlight to-starlight bg-clip-text tracking-[0.2em] text-5xl pb-2 select-none">Latent Space</div>
      <div className="h-1 w-full border-none bg-linear-to-r from-echo to-transparent rounded-full transform-gpu drop-shadow-[0_0_16px_rgba(133,125,255,1),0_0_8px_rgba(133,125,255,1)]" />
    </div>

    {/*Dummy container to test the size available*/}
    <div ref={ref} className="h-full w-full pointer-events-none z-0" />
    {rect && (
      <GalaxyMap rect={rect} config={config} />
    )}

    <div className="group absolute flex flex-col items-center justify-center h-8 w-8 rounded-xl bottom-0 right-0 bg-transparent border border-transparent transition-all duration-400 transform-gpu
    hover:border-nebula hover:bg-liquid hover:h-55 hover:w-100 hover:rounded-xl z-50">
      <CircleQuestionMark size={30} strokeWidth={1.0} className="text-nebula opacity-100 group-hover:opacity-0 transition-all duration-200 absolute" />
      <div className="font-mono bg-linear-to-br from-starlight to-echo bg-clip-text text-transparent group-hover:opacity-100 opacity-0 transition-all duration-100 group-hover:duration-2000 text-lg p-6">
        This is your latent space - a snapshot of your galaxy.<br /><br />Each star is a projected fragment drifting through semantic space.</div>
    </div>


  </div>))
}

function App() {
  const [notes_n, setNotesN] = useState(0);
  const [screen, setScreen] = useState(0);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    const getConfig = async () => {
      try {
        const c = await invoke("init_config");
        setConfig(c as Config);

        await getCurrentWindow().setAlwaysOnTop((c as Config)["always_on_top"])
      } catch (err) {
        toast.error("Failed to fetch settings", { description: `${err}` });
      }
    };
    getConfig();
  }, []);

  useEffect(() => {
    const getCount = async () => {
      try {
        const res = await invoke("sql_n");
        setNotesN(res as number);
      } catch (err) {
        toast.error("Failed to fetch fragment count", { description: `${err}` })
      }
    };
    getCount();
  }, []);

  useEffect(() => {
    const loadModels = async () => {
      {/* Lets the UI render once before loading models so the user doesnt stay on a blank screen*/ }
      await delay(1000);
      const lt = toast.loading("Waking the Void...");
      await delay(500);

      try {
        await invoke("load_models");
      } catch (err) {
        toast.error("Failed to load models", { description: `${err}` })
      } finally {
        toast.dismiss(lt);
      }
    };

    loadModels();
  }, []);

  return (
    <>
      <div
        data-tauri-drag-region
        className="fixed top-0 left-0 right-0 h-8 z-9999 bg-transparent"
        onMouseDown={(event) => {
          if (event.button === 0) {
            void getCurrentWindow().startDragging();
          }
        }}
      />
      <main className="relative h-screen w-screen bg-void flex flex-col items-center justify-center p-8 selection:bg-white/10 select-text">
        <Toaster
          position="bottom-right"
          theme="dark"
          closeButton
          duration={Infinity}
          richColors />
        <SideBar screen={screen} setScreen={setScreen} />
        <AnimatePresence mode="wait">
          {(screen === 0)
            ? <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              key={"main"}>
              <MainScreen notes_n={notes_n} setNotesN={setNotesN} config={config} /></motion.div>
            : (screen === 1)
              ? <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 3.0 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                key={"latent"}
                className="w-full h-full">
                <LatentSpaceScreen config={config} /></motion.div>
              : (screen === 2)
                ? <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  key={"archive"}
                  className="w-full h-full">
                  <ArchiveScreen config={config} notes_n={notes_n} setNotesN={setNotesN} /></motion.div>
                : <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  exit={{ opacity: 0, transition: { duration: 0.2 } }}
                  key={"settings"}
                  className="w-full h-full">
                  <SettingsScreen config={config} setConfig={setConfig} /></motion.div>
          }
        </AnimatePresence>
      </main>
    </>
  );
}

export default App;
