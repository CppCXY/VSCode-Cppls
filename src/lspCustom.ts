export interface IServerPosition {
    line: number;
    character: number;
}

export interface IServerRange {
    start: IServerPosition;
    end: IServerPosition;
}

export interface IServerLocation {
    uri: string;
    range: IServerRange;
}
