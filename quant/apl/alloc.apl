⍝ Implied Automation, step 3: spread each company's AI revenue over the jobs it automates.
⍝ W  companies × jobs   raw weight: wage pool × AI exposure where the company sells into that job, else 0
⍝ R  companies × horizons   extra yearly revenue the market expects from AI ($bn, labour share applied)
⍝ P  jobs                yearly wage pool ($bn)
⍝ Each company's revenue is split across its jobs in proportion to W, summed per job,
⍝ then grossed up by the capture rate k (the share of replaced pay that AI sellers keep as revenue).
⍝ The share saturates smoothly, 1 - e^-x, so no job can be more than fully automated.
N←W÷⍉(⌽⍴W)⍴+/W
D←(⍉N)+.×R
Share←{1-*-(D÷⍵)÷⍉(⌽⍴D)⍴P}
