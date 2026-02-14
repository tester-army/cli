import { For } from "solid-js"
import { THEME } from "../theme/opencode"

const raw = `
                 100012223210115
             0001223333333334443213
           $?112222233333333444444414
          ??11122222223333333334444421
        2??01111222222233333333333444214
        ?0000111122222222223333333333322
       0?10001111222222222222223333333315
       ??000011111222222222222222233333114
       01000001111122222222223333333333311
       02000000011122222200000?!aaaaaa!00001
       1100000120??a!22277788888899988c++;a!@
       ?210?!bcc;88890..cc0WWW8,.-!+W#8+;c!
      !?bc;+::;c9$W#6...??,5##=....,$#W;?@
      ?a;;:27bca$####=.....###8,,,.+W#$c
        @5c1788$$######bb#############?0
          9;1889$$WW#################3cW
            !b7889$$WWW#WWWWWWWWWWW$bb
             8ac57999$$$WWWWWWW$$7!c!
                 ?bbc07666677?cbc$
`.split("\n")

const logo = raw.filter((line) => line.trim().length > 0)
const leftPad = Math.min(...logo.map((line) => line.match(/^ */)?.[0].length ?? 0))
const lines = logo.map((line) => line.slice(leftPad))
const logoWidth = Math.max(...lines.map((line) => line.length))

export function Logo() {
  return (
    <box flexDirection="column" alignItems="center">
      <box width={logoWidth} flexDirection="column" alignItems="flex-start">
        <For each={lines}>
          {(line, index) => (
            <text fg={index() < 12 ? THEME.primary : THEME.text}>{line}</text>
          )}
        </For>
      </box>
      <box height={1} />
      <box width={logoWidth} flexDirection="row" justifyContent="center">
        <text fg={THEME.primary}>
          <b>TESTER ARMY</b>
        </text>
      </box>
    </box>
  )
}
