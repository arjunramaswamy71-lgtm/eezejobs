(* Implied Automation, step 2: reverse DCF in OCaml.

   For every company and month-end, find the 10-year revenue growth rate g that makes a
   discounted cash flow model equal the market's enterprise value. That g is what the market is
   pricing in. Then compare it with what the market priced in the day before ChatGPT launched
   (30 Nov 2022): the extra revenue it now expects is the market's bet on AI.

   Build and run from the project folder:
     ocamlopt quant/ocaml/reverse_dcf.ml -o quant/ocaml/reverse_dcf && ./quant/ocaml/reverse_dcf
   Reads quant/out/panel.csv, writes quant/out/implied_growth.csv and quant/out/ai_revenue.csv *)

(* ---------- Model settings ---------- *)
let risk_free = 0.045          (* long-run Treasury yield *)
let equity_premium = 0.05      (* extra return investors want for owning stocks *)
let years = 10                 (* explicit forecast years before the terminal value *)
let terminal_growth = 0.025    (* growth forever after year 10 *)
let base_date = "2022-11-30"   (* the last month-end before ChatGPT *)
let horizons = [ 1; 3; 5; 10 ]

let clamp lo hi x = if x < lo then lo else if x > hi then hi else x

type row = {
  sym : string;
  date : string;
  ev : float;
  revenue : float;
  margin : float;  (* steady-state free cash flow margin *)
  rate : float;    (* discount rate from CAPM *)
}

(* Value of the firm if revenue grows at g for [years] years, then at terminal_growth forever *)
let dcf_value ~revenue ~margin ~rate g =
  let rec go t acc rev disc =
    if t > years then (acc, rev, disc)
    else
      let rev = rev *. (1.0 +. g) and disc = disc /. (1.0 +. rate) in
      go (t + 1) (acc +. (rev *. margin *. disc)) rev disc
  in
  let pv, last_rev, last_disc = go 1 0.0 revenue 1.0 in
  let terminal = last_rev *. (1.0 +. terminal_growth) *. margin /. (rate -. terminal_growth) in
  pv +. (terminal *. last_disc)

(* Brent's method: bracketed root finding that mixes bisection, secant and inverse quadratic steps *)
let brent f a b ~tol ~max_iter =
  let fa = f a and fb = f b in
  if fa *. fb > 0.0 then None
  else begin
    let a = ref a and b = ref b and fa = ref fa and fb = ref fb in
    if abs_float !fa < abs_float !fb then begin
      let t = !a in a := !b; b := t;
      let t = !fa in fa := !fb; fb := t
    end;
    let c = ref !a and fc = ref !fa and d = ref 0.0 and mflag = ref true in
    let result = ref None and i = ref 0 in
    while !result = None && !i < max_iter do
      incr i;
      if abs_float !fb < tol || abs_float (!b -. !a) < tol then result := Some !b
      else begin
        let s =
          if !fa <> !fc && !fb <> !fc then
            (!a *. !fb *. !fc /. ((!fa -. !fb) *. (!fa -. !fc)))
            +. (!b *. !fa *. !fc /. ((!fb -. !fa) *. (!fb -. !fc)))
            +. (!c *. !fa *. !fb /. ((!fc -. !fa) *. (!fc -. !fb)))
          else !b -. (!fb *. (!b -. !a) /. (!fb -. !fa))
        in
        let lo = ((3.0 *. !a) +. !b) /. 4.0 in
        let between = (s > min lo !b) && (s < max lo !b) in
        let s =
          if (not between)
             || (!mflag && abs_float (s -. !b) >= abs_float (!b -. !c) /. 2.0)
             || ((not !mflag) && abs_float (s -. !b) >= abs_float (!c -. !d) /. 2.0)
          then (mflag := true; (!a +. !b) /. 2.0)
          else (mflag := false; s)
        in
        let fs = f s in
        d := !c; c := !b; fc := !fb;
        if !fa *. fs < 0.0 then (b := s; fb := fs) else (a := s; fa := fs);
        if abs_float !fa < abs_float !fb then begin
          let t = !a in a := !b; b := t;
          let t = !fa in fa := !fb; fb := t
        end
      end
    done;
    (match !result with None -> Some !b | r -> r)
  end

(* The growth rate the market is pricing in *)
let implied_growth r =
  let f g = dcf_value ~revenue:r.revenue ~margin:r.margin ~rate:r.rate g -. r.ev in
  match brent f (-0.6) 2.0 ~tol:1e-10 ~max_iter:200 with
  | Some g -> g
  | None -> if f (-0.6) > 0.0 then -0.6 else 2.0

(* ---------- CSV helpers ---------- *)
let read_lines path =
  let ic = open_in path in
  let rec loop acc = match input_line ic with
    | l -> loop (l :: acc)
    | exception End_of_file -> close_in ic; List.rev acc
  in
  loop []

let parse_panel path =
  match read_lines path with
  | [] -> []
  | header :: rows ->
    let cols = String.split_on_char ',' header in
    let idx name =
      let rec find i = function [] -> failwith ("missing column " ^ name) | c :: t -> if c = name then i else find (i + 1) t in
      find 0 cols
    in
    let i_sym = idx "sym" and i_date = idx "date" and i_ev = idx "ev" and i_rev = idx "revenue"
    and i_m = idx "fcf_margin" and i_beta = idx "beta" in
    let i_n = try Some (idx "nopat_margin") with Failure _ -> None in
    List.filter_map (fun line ->
        let f = Array.of_list (String.split_on_char ',' line) in
        let num i = try float_of_string f.(i) with _ -> nan in
        let ev = num i_ev and revenue = num i_rev and beta = num i_beta in
        (* Steady-state margin: the better of after-tax operating margin and free cash flow margin,
           so today's heavy AI data-centre spending doesn't make a company look less profitable than it is *)
        let fcf = num i_m and nopat = match i_n with Some i -> num i | None -> nan in
        let m = match Float.is_nan fcf, Float.is_nan nopat with
          | true, true -> nan | true, false -> nopat | false, true -> fcf | false, false -> Float.max fcf nopat in
        if Float.is_nan ev || Float.is_nan revenue || revenue <= 0.0 || ev <= 0.0 then None
        else
          let beta = if Float.is_nan beta then 1.0 else clamp 0.7 1.8 beta in
          let margin = if Float.is_nan m then 0.15 else clamp 0.08 0.40 m in
          Some { sym = f.(i_sym); date = String.sub f.(i_date) 0 10; ev; revenue; margin;
                 rate = risk_free +. (beta *. equity_premium) })
      rows

let years_between d1 d2 =
  let parse d = Scanf.sscanf d "%d-%d-%d" (fun y m dd -> float y +. (float (m - 1) /. 12.0) +. (float dd /. 365.0)) in
  parse d2 -. parse d1

let () =
  let dir = if Array.length Sys.argv > 1 then Sys.argv.(1) else "quant/out" in
  let t0 = Sys.time () in
  let rows = parse_panel (Filename.concat dir "panel.csv") in
  let solved = List.map (fun r -> (r, implied_growth r)) rows in
  let t1 = Sys.time () in

  let oc = open_out (Filename.concat dir "implied_growth.csv") in
  output_string oc "sym,date,implied_growth,discount_rate,fcf_margin,revenue,ev\n";
  List.iter (fun (r, g) -> Printf.fprintf oc "%s,%s,%.6f,%.4f,%.4f,%.6g,%.6g\n" r.sym r.date g r.rate r.margin r.revenue r.ev) solved;
  close_out oc;

  (* Group by company, keep date order *)
  let by_sym = Hashtbl.create 64 in
  List.iter (fun (r, g) ->
      let prev = try Hashtbl.find by_sym r.sym with Not_found -> [] in
      Hashtbl.replace by_sym r.sym ((r, g) :: prev)) solved;

  let oc = open_out (Filename.concat dir "ai_revenue.csv") in
  output_string oc "sym,date,implied_growth,base_growth,revenue,base_revenue";
  List.iter (fun h -> Printf.fprintf oc ",ai_rev_%dy" h) horizons;
  output_string oc "\n";
  let summary = ref [] in
  Hashtbl.iter (fun sym lst ->
      let lst = List.sort (fun (a, _) (b, _) -> compare a.date b.date) lst in
      (* The baseline: the last month-end on or before the day ChatGPT launched *)
      let base = List.fold_left (fun acc (r, g) -> if r.date <= base_date then Some (r, g) else acc) None lst in
      match base with
      | None -> ()
      | Some (b, gb) ->
        List.iter (fun (r, g) ->
            if r.date >= base_date then begin
              let dt = years_between b.date r.date in
              (* Extra revenue the market now expects in year t+h, versus what it expected before ChatGPT *)
              let extra h =
                let hf = float h in
                (r.revenue *. ((1.0 +. g) ** hf)) -. (b.revenue *. ((1.0 +. gb) ** (dt +. hf)))
              in
              Printf.fprintf oc "%s,%s,%.6f,%.6f,%.6g,%.6g" sym r.date g gb r.revenue b.revenue;
              List.iter (fun h -> Printf.fprintf oc ",%.6g" (extra h)) horizons;
              output_string oc "\n"
            end) lst;
        let r, g = List.nth lst (List.length lst - 1) in
        summary := (sym, gb, g, r.date) :: !summary)
    by_sym;
  close_out oc;

  Printf.printf "OCaml reverse DCF: solved %d company-months with Brent's method in %.1f ms\n"
    (List.length solved) ((t1 -. t0) *. 1000.0);
  Printf.printf "%-6s %14s %14s %10s\n" "Ticker" "Before ChatGPT" "Now" "Change";
  List.iter (fun (s, gb, g, _) ->
      Printf.printf "%-6s %13.1f%% %13.1f%% %+9.1f pts\n" s (gb *. 100.0) (g *. 100.0) ((g -. gb) *. 100.0))
    (List.sort (fun (_, a, b, _) (_, c, d, _) -> compare (d -. c) (b -. a)) !summary);
  print_endline "Saved quant/out/implied_growth.csv and quant/out/ai_revenue.csv"
