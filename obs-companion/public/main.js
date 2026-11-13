import { MogiData } from "./src/mogidata.js";

const params = new URLSearchParams(location.search);
/** @type {(data:MogiData|null)=>void} */
const renderer = await (()=>new Promise(res=>{
	import(`./src/ui/${params.get('theme') || 'vertical'}.js`)
		.then(m => res(m.default))
		.catch(e => {
			document.body.append(`<p style="color:red">Failed to load theme ${params.get('theme') || 'vertical'}: ${e}</p>`);
			res(()=>{});
		});
}))();

const sse = new EventSource('/events');
sse.addEventListener('state', e=>{
	const rawData = JSON.parse(e.data);
	if( rawData.status === 'waiting') {
		// No data yet: let the theme clear itself, with nothing drawn over the stream.
		renderer(null);
	}
	else {
		const mogiData = MogiData.fromRaw(rawData);
		renderer(mogiData);
	}
});
