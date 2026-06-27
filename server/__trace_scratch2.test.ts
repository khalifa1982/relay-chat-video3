import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRegistry, handleMessage, type RelayRegistry, type RelaySocket } from "./relay";
class FakeConn {
  outbox: any[] = []; pin: string | null = null; socket: RelaySocket; cid: string | undefined;
  constructor(cid?: string){ this.cid=cid; this.socket={send:(o)=>this.outbox.push(o),close:()=>{}}; }
  setPin=(p:string)=>{this.pin=p;};
  asConn(){return {socket:this.socket,pin:this.pin,setPin:this.setPin,cid:this.cid};}
}
describe("scenario D detail", () => {
  let reg: RelayRegistry;
  beforeEach(()=>{reg=createRegistry();process.env.MULTI_DEVICE_RING="1";});
  afterEach(()=>{delete process.env.MULTI_DEVICE_RING;});
  it("what does caller2 receive on call-waiting?", () => {
    const c1=new FakeConn("c1"); handleMessage(reg,c1.asConn(),{type:"register",name:"C1"});
    const c2=new FakeConn("c2"); handleMessage(reg,c2.asConn(),{type:"register",name:"C2"});
    const d1=new FakeConn("dev1"); handleMessage(reg,d1.asConn(),{type:"register",name:"Callee"}); const number=d1.pin!;
    const d2=new FakeConn("dev2"); handleMessage(reg,d2.asConn(),{type:"register",name:"Callee",pin:number});
    handleMessage(reg,c1.asConn(),{type:"invite",to:number});
    const ring1=d1.outbox.find(m=>m.type==="ring");
    handleMessage(reg,d2.asConn(),{type:"accept",roomId:ring1.roomId});
    c2.outbox.length=0;
    handleMessage(reg,c2.asConn(),{type:"invite",to:number});
    console.log("caller2 received:", JSON.stringify(c2.outbox));
  });
  it("COMPARE flag OFF single-device: call-waiting works?", () => {
    delete process.env.MULTI_DEVICE_RING;
    const c1=new FakeConn("c1"); handleMessage(reg,c1.asConn(),{type:"register",name:"C1"});
    const c2=new FakeConn("c2"); handleMessage(reg,c2.asConn(),{type:"register",name:"C2"});
    const d1=new FakeConn("dev1"); handleMessage(reg,d1.asConn(),{type:"register",name:"Callee"}); const number=d1.pin!;
    handleMessage(reg,c1.asConn(),{type:"invite",to:number});
    const ring1=d1.outbox.find(m=>m.type==="ring");
    handleMessage(reg,d1.asConn(),{type:"accept",roomId:ring1.roomId});
    // now d1 in a 2-person call. c2 rings -> busy expected (real busy, since 2 people)
    c2.outbox.length=0; d1.outbox.length=0;
    handleMessage(reg,c2.asConn(),{type:"invite",to:number});
    console.log("FLAG-OFF caller2 received:", JSON.stringify(c2.outbox));
    console.log("FLAG-OFF d1 (in call) received:", JSON.stringify(d1.outbox.map(m=>m.type)));
  });
});
